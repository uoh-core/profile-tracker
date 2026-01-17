const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Paths
const REPO_ROOT = path.join(__dirname, '..');
const HTML_FILE = path.join(REPO_ROOT, 'index.html');

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL_HOURS || 1;

class DiscordMonitor {
    constructor() {
        if (!DISCORD_TOKEN || DISCORD_TOKEN === 'your_token_here') {
            console.log('⚠️  Using template token - will show as invalid');
        }
        
        this.headers = {
            'Authorization': DISCORD_TOKEN,
            'Content-Type': 'application/json'
        };
    }

    async checkToken() {
        try {
            // If using template token, simulate invalid
            if (!DISCORD_TOKEN || DISCORD_TOKEN === 'your_token_here') {
                return {
                    valid: false,
                    reason: 'template_token',
                    status: 'invalid'
                };
            }

            const response = await axios.get('https://discord.com/api/v9/users/@me', {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                return {
                    valid: true,
                    status: 'active'
                };
            }
        } catch (error) {
            if (error.response) {
                return {
                    valid: false,
                    reason: this.getReasonFromStatusCode(error.response.status),
                    status: 'invalid'
                };
            } else if (error.code === 'ECONNABORTED') {
                return {
                    valid: false,
                    reason: 'timeout',
                    status: 'error'
                };
            } else {
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
                const reason = statusData.reason === 'template_token' 
                    ? 'setup_required (add real token to .env)' 
                    : statusData.reason;
                    
                statusHtml = `
                <div class="status-section">
                    <p><strong>account status:</strong> <span style="color: #f04747;">● ${reason}</span></p>
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
                console.log('⚠️  Status markers not found, appending to body');
                const bodyCloseIndex = html.lastIndexOf('</body>');
                if (bodyCloseIndex !== -1) {
                    html = html.slice(0, bodyCloseIndex) + statusHtml + html.slice(bodyCloseIndex);
                } else {
                    html += statusHtml;
                }
            }

            await fs.writeFile(HTML_FILE, html, 'utf8');
            console.log(`✅ HTML updated`);

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
        console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Checking...`);
        
        const status = await this.checkToken();
        console.log(status.valid ? '✅ Token valid' : `❌ Token invalid: ${status.reason}`);
        
        await this.updateHTML(status);
        await this.commitAndPush();
        
        console.log(`⏰ Next check in ${CHECK_INTERVAL} hour(s)`);
    }

    start() {
        console.log('🚀 Discord Account Monitor');
        console.log('─'.repeat(40));
        
        // Run immediately
        this.runCheck();
        
        // Schedule subsequent runs
        const cronPattern = `0 */${CHECK_INTERVAL} * * *`;
        cron.schedule(cronPattern, () => this.runCheck());
        
        console.log(`⏰ Scheduled: every ${CHECK_INTERVAL} hour(s)`);
        console.log('─'.repeat(40));
    }
}

// Run the monitor
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