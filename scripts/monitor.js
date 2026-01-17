const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Paths
const REPO_ROOT = path.join(__dirname, '..');
const HTML_FILE = path.join(REPO_ROOT, 'index.html');
const STATUS_FILE = path.join(__PO_ROOT, 'status.json');

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL_HOURS || 1;

class DiscordMonitor {
    constructor() {
        if (!DISCORD_TOKEN) {
            throw new Error('DISCORD_TOKEN not set in .env file');
        }
        
        this.headers = {
            'Authorization': DISCORD_TOKEN,
            'Content-Type': 'application/json'
        };
    }

    async checkToken() {
        try {
            const response = await axios.get('https://discord.com/api/v9/users/@me', {
                headers: this.headers
            });

            if (response.status === 200) {
                const user = response.data;
                return {
                    valid: true,
                    username: `${user.username}#${user.discriminator}`,
                    userId: user.id,
                    avatar: user.avatar,
                    premiumType: user.premium_type || 0,
                    status: 'active'
                };
            }
        } catch (error) {
            if (error.response) {
                // Discord API returned an error
                return {
                    valid: false,
                    statusCode: error.response.status,
                    reason: this.getReasonFromStatusCode(error.response.status),
                    status: 'invalid'
                };
            } else {
                // Network error
                return {
                    valid: false,
                    reason: 'network_error',
                    status: 'error'
                };
            }
        }
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

    async updateHTML(statusData) {
        try {
            // Read current HTML
            let html = await fs.readFile(HTML_FILE, 'utf8');
            
            const timestamp = new Date().toISOString();
            const localTime = new Date().toLocaleString('en-US', {
                timeZone: 'UTC',
                dateStyle: 'full',
                timeStyle: 'short'
            });

            let statusHtml;
            if (statusData.valid) {
                statusHtml = `
                <div class="status-section">
                    <p><strong>account status:</strong> <span style="color: #43b581;">● Active</span></p>
                    <p><strong>last checked:</strong> ${localTime} UTC</p>
                    <p><em>updated automatically every ${CHECK_INTERVAL} hour(s)</em></p>
                </div>
                `;
            } else {
                statusHtml = `
                <div class="status-section">
                    <p><strong>account status:</strong> <span style="color: #f04747;">● ${statusData.reason}</span></p>
                    <p><strong>last checked:</strong> ${localTime} UTC</p>
                    <p><em>updated automatically every ${CHECK_INTERVAL} hour(s)</em></p>
                </div>
                `;
            }

            // Update using regex pattern
            const statusPattern = /<!-- STATUS_START -->[\s\S]*?<!-- STATUS_END -->/;
            const replacement = `<!-- STATUS_START -->\n${statusHtml}\n<!-- STATUS_END -->`;
            
            if (statusPattern.test(html)) {
                html = html.replace(statusPattern, replacement);
            } else {
                // Fallback: append before closing body tag
                const bodyCloseIndex = html.lastIndexOf('</body>');
                html = html.slice(0, bodyCloseIndex) + statusHtml + html.slice(bodyCloseIndex);
            }

            // Write updated HTML
            await fs.writeFile(HTML_FILE, html, 'utf8');
            console.log(`✅ HTML updated at ${new Date().toISOString()}`);

            // Also save status to JSON file for backup
            await fs.writeFile(STATUS_FILE, JSON.stringify({
                ...statusData,
                lastUpdated: timestamp,
                nextCheck: new Date(Date.now() + CHECK_INTERVAL * 3600000).toISOString()
            }, null, 2));

        } catch (error) {
            console.error('❌ Error updating HTML:', error.message);
        }
    }

    async commitAndPush() {
        try {
            const simpleGit = require('simple-git');
            const git = simpleGit(REPO_ROOT);
            
            // Check if there are changes
            const status = await git.status();
            
            if (status.modified.length > 0 || status.not_added.length > 0) {
                await git.add('.');
                await git.commit(`Update account status - ${new Date().toISOString()}`);
                await git.push();
                console.log(`🚀 Changes pushed to GitHub at ${new Date().toISOString()}`);
            } else {
                console.log('📭 No changes to commit');
            }
        } catch (error) {
            console.error('❌ Git error:', error.message);
        }
    }

    async runCheck() {
        console.log(`\n🔍 Checking Discord token at ${new Date().toISOString()}...`);
        
        const status = await this.checkToken();
        console.log(status.valid ? '✅ Token valid' : `❌ Token invalid: ${status.reason}`);
        
        await this.updateHTML(status);
        await this.commitAndPush();
        
        console.log(`⏰ Next check in ${CHECK_INTERVAL} hour(s)...\n`);
    }

    start() {
        console.log('🚀 Discord Account Monitor Started');
        console.log('=' .repeat(50));
        console.log(`Token: ${DISCORD_TOKEN.substring(0, 10)}...`);
        console.log(`Check interval: ${CHECK_INTERVAL} hour(s)`);
        console.log('=' .repeat(50));
        
        // Run immediately
        this.runCheck();
        
        // Schedule subsequent runs
        const cronPattern = `0 */${CHECK_INTERVAL} * * *`; // Every X hours
        cron.schedule(cronPattern, () => this.runCheck());
        
        console.log(`⏰ Scheduled with pattern: ${cronPattern}\n`);
    }
}

// Run the monitor
const monitor = new DiscordMonitor();
monitor.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down monitor...');
    process.exit(0);
});