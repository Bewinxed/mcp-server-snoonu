// Add verbose logging
const CDP = require('chrome-remote-interface');

async function testConnection() {
    try {
        const client = await CDP({
            host: '127.0.0.1',
            port: 9111
        });
        console.log('CDP connected!');
        const {Network, Page} = client;
        await Network.enable();
        await Page.enable();
        console.log('Protocol enabled!');
    } catch (err) {
        console.error('CDP Error:', err);
    }
}

testConnection()