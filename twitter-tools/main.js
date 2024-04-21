const puppeteer = require('puppeteer');

const save_headers = {};
(async () => {
    console.log("Waiting for login...\n")
    let over = false;

    const width = 1280;
    const height = 800;
    const browser = await puppeteer.launch({
        args: [
            '--no-sandbox',
            `--window-size=${width},${height}`
        ],
        headless: false
    });
    const page = await browser.newPage();

    await page.setViewport({ width: width, height: height });

    page.on('request', async (request) => {
        const url = request.url();

        if (url.includes('twitter.com/i/api/graphql')) {
            const headers = request.headers();
            if (headers.authorization && headers['x-csrf-token'] && !over) {
                over = true;
                save_headers.authorization = headers.authorization.trim();
                save_headers['x-csrf-token'] = headers['x-csrf-token'].trim();
                const cookies = await page.cookies();
                save_headers.cookie = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ').trim();
                await browser.close();

                for (let i in save_headers) {
                    console.log(i + "=" + save_headers[i]);
                }

                console.log("\nPress any key to exit...");
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.on('data', process.exit.bind(process, 0));
            }
        }
    });

    await page.goto('https://twitter.com');
})();