import { Page } from "@playwright/test";

require('dotenv').config();

export class GeneralUtils {
    username : string;
    password : string;
    page : Page;

    constructor(page : Page) {
        this.username = process.env.EMAIL!;
        this.password = process.env.PASSWORD!;
        this.page = page;
    }

    public static async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public static async randomSleep(min: number, max: number) {
        const ms = Math.floor(Math.random() * (max - min + 1) + min);
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 🚀 PUSAT SIMULASI MOUSE MANUSIA (GLOBAL)
     */
    public static async humanMouseMove(page: Page, targetX: number, targetY: number) {
        const steps = Math.floor(Math.random() * 5) + 6; 
        let currentX = targetX + (Math.random() * 200 - 100);
        let currentY = targetY + (Math.random() * 200 - 100);

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const noiseX = (Math.random() - 0.5) * 5;
            const noiseY = (Math.random() - 0.5) * 5;
            
            const x = currentX + (targetX - currentX) * t + noiseX;
            const y = currentY + (targetY - currentY) * t + noiseY;

            await page.mouse.move(x, y);
            await page.waitForTimeout(Math.floor(Math.random() * 15) + 10);
        }
        await page.mouse.move(targetX, targetY);
    }

    /**
     * 🚀 PUSAT SELEKSI KLIK MANUSIA (GLOBAL)
     * Ditambahkan customTimeout opsional agar elemen pertama bisa menunggu lebih lama tanpa merubah global timeout elemen lain.
     */
    public static async moveAndClick(page: Page, locator: any, customTimeout = 10000) {
        // Menggunakan customTimeout jika dipasing, jika tidak kembali ke default 10 detik
        await locator.waitFor({ state: 'visible', timeout: customTimeout });
        const box = await locator.boundingBox();
        
        if (box) {
            const paddingX = box.width * 0.15;
            const paddingY = box.height * 0.15;

            const randomX = box.x + paddingX + (Math.random() * (box.width - (paddingX * 2)));
            const randomY = box.y + paddingY + (Math.random() * (box.height - (paddingY * 2)));

            await this.humanMouseMove(page, randomX, randomY);
            await this.randomSleep(200, 500); 

            await page.mouse.down();
            await this.randomSleep(80, 220); 
            await page.mouse.up();
        } else {
            await locator.click();
        }
    }

    public static async humanClick(page: Page, selectorOrLocator: any) {
        const locator = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator) : selectorOrLocator;
        await this.moveAndClick(page, locator);
    }

    public async login(page: Page) {
        console.log('Iniciando login no Airline Manager 4...')

        await page.goto('https://www.airlinemanager.com/');
        
        // 🚀 OPTIMALISASI 1: Daripada tidur kaku 5 detik, kita suruh Playwright menunggu sampai network idle (aset selesai diunduh)
        // Jika server super cepat, proses ini hanya memakan waktu 1-2 detik saja!
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => console.log("Rede ainda esta carregando; continuando..."));

        // Abrir o jogo e verificar a transicao antes de procurar o formulario.
        // Usar locator.click() permite ao Playwright esperar estabilidade do elemento.
        const playFreeButton = page.getByRole('button', { name: /play free now/i });
        await playFreeButton.waitFor({ state: 'visible', timeout: 30000 });

        let loginOpened = false;
        const loginMenuButton = page.getByRole('button', { name: /log\s*in|sign\s*in/i });

        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`[Login] Tentativa ${attempt}/3 de abrir o jogo...`);
            if (await page.locator('#lEmail').isVisible()) {
                loginOpened = true;
                break;
            }

            if (await loginMenuButton.first().isVisible()) {
                loginOpened = true;
                break;
            }

            try {
                await playFreeButton.click({ timeout: 12000 });
            } catch (error) {
                console.warn('[Login] Clique em PLAY FREE NOW falhou:', error);
            }

            try {
                await loginMenuButton.first().waitFor({ state: 'visible', timeout: 7000 });
                loginOpened = true;
                break;
            } catch {
                if (await page.locator('#lEmail').isVisible()) {
                    loginOpened = true;
                    break;
                }
                console.warn('[Login] O jogo ainda nao mostrou o acesso; tentando novamente.');
                await page.waitForTimeout(1500);
            }
        }

        if (!loginOpened) {
            await page.screenshot({
                path: 'test-results/login-start-failed.png',
                fullPage: true
            });
            throw new Error('[Login] PLAY FREE NOW nao abriu a tela de acesso.');
        }

        if (!(await page.locator('#lEmail').isVisible())) {
            console.log('[Login] Abrindo formulario de acesso...');
            await loginMenuButton.first().click({ timeout: 15000 });
        }

        try {
            await page.locator('#lEmail').waitFor({ state: 'visible', timeout: 12000 });
        } catch (error) {
            console.error('[Login] Formulario de acesso nao apareceu. URL:', page.url());
            await page.screenshot({
                path: 'test-results/login-form-not-found.png',
                fullPage: true
            });
            throw error;
        }
        await GeneralUtils.randomSleep(1000, 2000);

        // --- Proses Pengisian Email ---
        const emailInput = page.locator('#lEmail');
        await GeneralUtils.moveAndClick(page, emailInput);
        await GeneralUtils.randomSleep(400, 800);
        await emailInput.pressSequentially(this.username, { delay: Math.floor(Math.random() * 80) + 40 });
        await GeneralUtils.randomSleep(500, 1200);
        
        // --- Proses Pengisian Password ---
        const passwordInput = page.locator('#lPass');
        await GeneralUtils.moveAndClick(page, passwordInput);
        await GeneralUtils.randomSleep(400, 800);
        await passwordInput.pressSequentially(this.password, { delay: Math.floor(Math.random() * 80) + 40 });
        await GeneralUtils.randomSleep(1000, 2000); 

        // Gerakkan mouse melengkung dan klik tombol submit "Log In" final
        const submitLoginButton = page.getByRole('button', { name: 'Log In', exact: true });
        await GeneralUtils.moveAndClick(page, submitLoginButton);
        
        console.log('Tentativa de login concluida; validando operacoes seguintes.');
    }
}
