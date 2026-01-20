const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Paths
const REPO_ROOT = path.join(__dirname, '..');
const HTML_FILE = path.join(REPO_ROOT, 'index.html');

// Configuration - get all tokens from env
const DISCORD_TOKEN_44 = process.env.DISCORD_TOKEN_44;
const CURRENT_TOKEN = DISCORD_TOKEN_44;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL_HOURS || 1;

class DiscordMonitor {
    constructor() {
        this.headers = {
            'Authorization': CURRENT_TOKEN,
            'Content-Type': 'application/json'
        };
    }

    async fetchAccountInfo() {
        try {
            if (!CURRENT_TOKEN) {
                return {
                    success: false,
                    error: 'No token provided in .env',
                    status: 'invalid'
                };
            }

            const response = await axios.get('https://discord.com/api/v9/users/@me', {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const user = response.data;
                
                // Extract index from username (assuming format like "44.uoh")
                const usernameMatch = user.username.match(/^(\d+)/);
                const index = usernameMatch ? `${usernameMatch[1]}th index` : 'Unknown index';
                
                // Format tag
                const tag = `@${user.username}`;
                
                // Calculate account creation date from user ID (snowflake)
                const creationDate = this.snowflakeToDate(user.id);
                
                return {
                    success: true,
                    data: {
                        index: index,
                        tag: tag,
                        userId: user.id,
                        username: user.username,
                        discriminator: user.discriminator,
                        creationDate: creationDate,
                        avatar: user.avatar,
                        status: 'active'
                    }
                };
            }
        } catch (error) {
            if (error.response) {
                return {
                    success: false,
                    error: this.getReasonFromStatusCode(error.response.status),
                    status: 'invalid'
                };
            } else {
                return {
                    success: false,
                    error: 'network_error',
                    status: 'error'
                };
            }
        }
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

    async updateHTML(accountInfo) {
        try {
            let html = await fs.readFile(HTML_FILE, 'utf8');
            
            const now = new Date();
            const localTime = now.toLocaleString('en-US', {
                timeZone: 'UTC',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            if (accountInfo.success) {
                const data = accountInfo.data;
                
                // Update the entire profile section
                const profilePattern = /<h1>current profile<\/h1>[\s\S]*?<!-- STATUS_START -->/;
                const profileReplacement = `<h1>current profile</h1>
    <p><strong>index:</strong> ${data.index}</p>
    <p><strong>tag:</strong> ${data.tag}</p>
    <p><strong>user id:</strong> <span id="userId">${data.userId}</span></p>
    <p><strong>account created:</strong> <span id="creationDate">${data.creationDate}</span></p>

    <!-- STATUS_START -->`;
                
                if (profilePattern.test(html)) {
                    html = html.replace(profilePattern, profileReplacement);
                }
                
                // Update status section
                const statusHtml = `
                <div class="status-section">
                    <p><strong>account status:</strong> <span style="color: #43b581;">● Active</span></p>
                    <p><strong>last checked:</strong> ${localTime} UTC</p>
                    <p><em>updated automatically every ${CHECK_INTERVAL} hour(s)</em></p>
                </div>
                `;
                
                const statusPattern = /<!-- STATUS_START -->[\s\S]*?<!-- STATUS_END -->/;
                const statusReplacement = `<!-- STATUS_START -->\n${statusHtml}\n<!-- STATUS_END -->`;
                
                if (statusPattern.test(html)) {
                    html = html.replace(statusPattern, statusReplacement);
                }
                
            } else {
                // Token is invalid
                const statusHtml = `
                <div class="status-section">
                    <p><strong>account status:</strong> <span style="color: #f04747;">● ${accountInfo.error}</span></p>
                    <p><strong>last checked:</strong> ${localTime} UTC</p>
                    <p><em>updated automatically every ${CHECK_INTERVAL} hour(s)</em></p>
                </div>
                `;
                
                const statusPattern = /<!-- STATUS_START -->[\s\S]*?<!-- STATUS_END -->/;
                const statusReplacement = `<!-- STATUS_START -->\n${statusHtml}\n<!-- STATUS_END -->`;
                
                if (statusPattern.test(html)) {
                    html = html.replace(statusPattern, statusReplacement);
                }
            }

            await fs.writeFile(HTML_FILE, html, 'utf8');
            console.log(`✅ HTML updated with account data`);
            
        } catch (error) {
            console.error('❌ Error updating HTML:', error.message);
        }
    }

    async commitAndPush() {
        try {
            const simpleGit = require('simple-git');
            const git = simpleGit(REPO_ROOT);
            
            await git.add('.');
            await git.commit(`Update: ${new Date().toISOString()}`);
            await git.push();
            console.log(`✅ Pushed to GitHub`);
        } catch (error) {
            console.error('❌ Git error:', error.message);
        }
    }

    async runCheck() {
        console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Fetching account info...`);
        
        const accountInfo = await this.fetchAccountInfo();
        
        if (accountInfo.success) {
            console.log(`✅ Account info retrieved:`);
            console.log(`   Index: ${accountInfo.data.index}`);
            console.log(`   Tag: ${accountInfo.data.tag}`);
            console.log(`   User ID: ${accountInfo.data.userId}`);
            console.log(`   Created: ${accountInfo.data.creationDate}`);
        } else {
            console.log(`❌ Failed: ${accountInfo.error}`);
        }
        
        await this.updateHTML(accountInfo);
        await this.commitAndPush();
        
        console.log(`⏰ Next check in ${CHECK_INTERVAL} hour(s)`);
    }

    start() {
        console.log('🚀 Discord Account Monitor');
        console.log('─'.repeat(40));
        console.log(`Fetching data from token: ${CURRENT_TOKEN ? '✓ Set' : '✗ Missing'}`);
        console.log(`Check interval: ${CHECK_INTERVAL} hour(s)`);
        console.log('─'.repeat(40));
        
        // Initial run
        this.runCheck();
        
        // Schedule subsequent runs
        const cronPattern = `0 */${CHECK_INTERVAL} * * *`;
        cron.schedule(cronPattern, () => this.runCheck());
        
        console.log(`⏰ Scheduled: every ${CHECK_INTERVAL} hour(s)`);
        console.log('─'.repeat(40));
    }
}

// Start monitoring
try {
    const monitor = new DiscordMonitor();
    monitor.start();
} catch (error) {
    console.error('❌ Failed to start:', error.message);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    process.exit(0);
});