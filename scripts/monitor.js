const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Paths
const REPO_ROOT = path.join(__dirname, '..');
const HTML_FILE = path.join(REPO_ROOT, 'index.html');
const TEMPLATE_FILE = path.join(__dirname, 'template.html');
const ACCOUNTS_FILE = path.join(REPO_ROOT, 'accounts.json');

// Configuration
const CHECK_INTERVAL = process.env.CHECK_INTERVAL_HOURS || 1;

class DiscordMonitor {
    constructor() {
        this.tokens = this.getAllTokens();
        console.log(`Found ${Object.keys(this.tokens).length} account tokens`);
    }

    // Extract all DISCORD_TOKEN_* from environment
    getAllTokens() {
        const tokens = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith('DISCORD_TOKEN_') && value && value.trim() !== '') {
                const accountNumber = key.replace('DISCORD_TOKEN_', '');
                tokens[accountNumber] = value;
            }
        }
        return tokens;
    }

    async fetchAccountInfo(token, accountNumber) {
        try {
            if (!token) {
                return {
                    success: false,
                    accountNumber: accountNumber,
                    error: 'No token provided',
                    status: 'invalid'
                };
            }

            const headers = {
                'Authorization': token,
                'Content-Type': 'application/json'
            };

            const response = await axios.get('https://discord.com/api/v9/users/@me', {
                headers: headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const user = response.data;
                
                // Extract index from username (assuming format like "44.uoh")
                const usernameMatch = user.username.match(/^(\d+)/);
                const indexNum = usernameMatch ? parseInt(usernameMatch[1]) : 0;
                const index = `${indexNum}${this.getOrdinalSuffix(indexNum)} index`;
                
                // Format tag
                const tag = `@${user.username}`;
                
                // Calculate account creation date from user ID (snowflake)
                const creationDate = this.snowflakeToDate(user.id);
                
                return {
                    success: true,
                    accountNumber: accountNumber,
                    data: {
                        index: index,
                        indexNum: indexNum,
                        tag: tag,
                        userId: user.id,
                        username: user.username,
                        discriminator: user.discriminator,
                        creationDate: creationDate,
                        avatar: user.avatar,
                        status: 'active',
                        lastUpdated: new Date().toISOString()
                    }
                };
            }
        } catch (error) {
            if (error.response) {
                return {
                    success: false,
                    accountNumber: accountNumber,
                    error: this.getReasonFromStatusCode(error.response.status),
                    status: 'invalid'
                };
            } else {
                return {
                    success: false,
                    accountNumber: accountNumber,
                    error: 'network_error',
                    status: 'error'
                };
            }
        }
    }

    // Helper to get ordinal suffix (1st, 2nd, 3rd, 4th, etc.)
    getOrdinalSuffix(n) {
        const suffixes = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0];
    }

    // Convert Discord snowflake ID to creation date
    snowflakeToDate(snowflake) {
        const discordEpoch = 1420070400000;
        const timestamp = Math.floor(snowflake / 4194304) + discordEpoch;
        const date = new Date(timestamp);
        
        const formatter = new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'UTC',
            timeZoneName: 'short'
        });
        
        return formatter.format(date);
    }

    getReasonFromStatusCode(statusCode) {
        const reasons = {
            401: 'unauthorized',
            403: 'forbidden',
            404: 'not_found',
            429: 'rate_limited',
            500: 'server_error'
        };
        return reasons[statusCode] || 'unknown_error';
    }
    
    async loadExistingAccounts() {
        try {
            const data = await fs.readFile(ACCOUNTS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    async saveAccounts(accounts) {
        await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    }

    async fetchAllAccounts() {
        const existingAccounts = await this.loadExistingAccounts();
        const updatedAccounts = { ...existingAccounts };
        const results = [];

        console.log(`\n🔍 Fetching ${Object.keys(this.tokens).length} accounts...`);

        for (const [accountNumber, token] of Object.entries(this.tokens)) {
            console.log(`  Fetching account ${accountNumber}...`);
            
            const result = await this.fetchAccountInfo(token, accountNumber);
            results.push(result);

            if (result.success) {
                updatedAccounts[accountNumber] = result.data;
                console.log(`    ✅ ${result.data.tag} - ${result.data.status}`);
            } else {
                if (existingAccounts[accountNumber]) {
                    console.log(`    ⚠️  ${existingAccounts[accountNumber].tag || `Account ${accountNumber}`} - ${result.error} (keeping old data)`);
                    updatedAccounts[accountNumber] = {
                        ...existingAccounts[accountNumber],
                        status: 'invalid',
                        lastError: result.error,
                        lastUpdated: new Date().toISOString()
                    };
                } else {
                    console.log(`    ❌ Account ${accountNumber} - ${result.error}`);
                    updatedAccounts[accountNumber] = {
                        index: `${accountNumber}th index`,
                        tag: `@unknown`,
                        userId: 'unknown',
                        creationDate: 'unknown',
                        status: 'invalid',
                        lastError: result.error,
                        lastUpdated: new Date().toISOString()
                    };
                }
            }
        }

        await this.saveAccounts(updatedAccounts);

        return {
            results: results,
            accounts: updatedAccounts
        };
    }

    async updateHTML(accountsData) {
        try {
            // Read template
            let html = await fs.readFile(TEMPLATE_FILE, 'utf8');
            
            const now = new Date();
            const localTime = now.toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            // Convert accounts object to array and sort
            const accountsArray = Object.values(accountsData.accounts)
                .filter(account => account && account.indexNum)
                .sort((a, b) => b.indexNum - a.indexNum);

            // Generate status info HTML
            const activeCount = accountsArray.filter(a => a.status === 'active').length;
            const statusInfoHtml = `
            <div class="status-info">
                <p><strong>Last checked:</strong> ${localTime} UTC</p>
                <p><strong>Total accounts:</strong> ${accountsArray.length}</p>
                <p><strong>Active accounts:</strong> ${activeCount}</p>
                <p><em>Updated automatically every ${CHECK_INTERVAL} hour(s)</em></p>
            </div>
            `;

            // Generate accounts HTML
            let accountsHtml = '';
            accountsArray.forEach(account => {
                const statusColor = account.status === 'active' ? '#43b581' : 
                                  account.status === 'invalid' ? '#f04747' : '#faa61a';
                const statusText = account.status === 'active' ? '● Active' : 
                                  account.status === 'invalid' ? '● Invalid' : '● Unknown';
                
                accountsHtml += `
                <div class="account-card">
                    <h3>${account.index}</h3>
                    <p><strong>tag:</strong> ${account.tag}</p>
                    <p><strong>user id:</strong> ${account.userId}</p>
                    <p><strong>account created:</strong> ${account.creationDate}</p>
                    <p><strong>status:</strong> <span style="color: ${statusColor}">${statusText}</span></p>
                    ${account.lastError ? `<p><em>Error: ${account.lastError}</em></p>` : ''}
                    <p><small>Last updated: ${new Date(account.lastUpdated).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</small></p>
                </div>
                `;
            });

            // Replace placeholders in template
            html = html.replace('<!-- STATUS_INFO_PLACEHOLDER -->', statusInfoHtml);
            html = html.replace('<!-- ACCOUNTS_PLACEHOLDER -->', accountsHtml);

            await fs.writeFile(HTML_FILE, html, 'utf8');
            console.log(`✅ HTML updated with ${accountsArray.length} accounts`);
            
        } catch (error) {
            console.error('❌ Error updating HTML:', error.message);
        }
    }

    async commitAndPush() {
        try {
            const simpleGit = require('simple-git');
            const git = simpleGit(REPO_ROOT);
            
            await git.add('.');
            await git.commit(`Update: ${new Date().toISOString()} - ${Object.keys(this.tokens).length} accounts`);
            await git.push();
            console.log(`✅ Pushed to GitHub`);
        } catch (error) {
            console.error('❌ Git error:', error.message);
        }
    }

    async runCheck() {
        console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Checking all accounts...`);
        
        const accountsData = await this.fetchAllAccounts();
        
        const successful = accountsData.results.filter(r => r.success).length;
        const total = accountsData.results.length;
        
        console.log(`\n📊 Summary: ${successful}/${total} accounts fetched successfully`);
        
        await this.updateHTML(accountsData);
        await this.commitAndPush();
        
        console.log(`⏰ Next check in ${CHECK_INTERVAL} hour(s)`);
    }

    start() {
        console.log('🚀 Discord Account Monitor');
        console.log('─'.repeat(50));
        console.log(`Found tokens for accounts: ${Object.keys(this.tokens).join(', ')}`);
        console.log(`Check interval: ${CHECK_INTERVAL} hour(s)`);
        console.log('─'.repeat(50));
        
        this.runCheck();
        
        const cronPattern = `0 */${CHECK_INTERVAL} * * *`;
        cron.schedule(cronPattern, () => this.runCheck());
        
        console.log(`⏰ Scheduled: every ${CHECK_INTERVAL} hour(s)`);
        console.log('─'.repeat(50));
    }
}

// Start monitoring
try {
    const monitor = new DiscordMonitor();
    monitor.start();
} catch (error) {
    console.error('❌ Failed to start:', error.message);
}

process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    process.exit(0);
});