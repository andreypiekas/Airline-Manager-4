import { Page } from "@playwright/test";
import { GeneralUtils } from "./general.utils";

require('dotenv').config();

export class FuelUtils {
    maxFuelPrice : number;
    maxCo2Price : number;
    page : Page;

    constructor(page : Page) {
        this.maxFuelPrice = parseInt(process.env.MAX_FUEL_PRICE!);
        this.maxCo2Price = parseInt(process.env.MAX_CO2_PRICE!);
        this.page = page;

        if (!Number.isFinite(this.maxFuelPrice) || this.maxFuelPrice <= 0) {
            throw new Error('MAX_FUEL_PRICE deve ser um numero positivo.');
        }
        if (!Number.isFinite(this.maxCo2Price) || this.maxCo2Price <= 0) {
            throw new Error('MAX_CO2_PRICE deve ser um numero positivo.');
        }

        console.log("Preco maximo do combustivel: " + this.maxFuelPrice);
        console.log("Preco maximo de CO2: " + this.maxCo2Price);
    }

    /**
     * Menyimulasi pergerakan kursor mouse yang halus dari posisi saat ini ke koordinat target.
     * Mencegah kursor melompat instan ala robot dengan memberikan efek kurva/noise mikro.
     */
    private async humanMouseMove(targetX: number, targetY: number) {
        const steps = Math.floor(Math.random() * 5) + 5; // 5-10 langkah pergerakan kursor
        let currentX = targetX + (Math.random() * 200 - 100);
        let currentY = targetY + (Math.random() * 200 - 100);

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const noiseX = (Math.random() - 0.5) * 5;
            const noiseY = (Math.random() - 0.5) * 5;
            
            const x = currentX + (targetX - currentX) * t + noiseX;
            const y = currentY + (targetY - currentY) * t + noiseY;

            await this.page.mouse.move(x, y);
            await this.page.waitForTimeout(Math.floor(Math.random() * 20) + 10);
        }
        await this.page.mouse.move(targetX, targetY);
    }

    /**
     * Helper privat untuk menggerakkan mouse ke elemen target secara acak di dalam area kotak,
     * lalu melakukan humanClick. Manusia tidak pernah mengklik tepat di tengah elemen secara konstan.
     */
    private async moveAndClick(locator: any) {
        const box = await locator.boundingBox();
        if (box) {
            // --- TRIK ACAK KOORDINAT (HUMAN RANDOMIZATION) ---
            // Kita beri batas aman padding 15% dari tepi kotak agar klik tidak meleset ke luar tombol
            const paddingX = box.width * 0.15;
            const paddingY = box.height * 0.15;

            // Mengacak titik tujuan di dalam area aman kotak tombol/input
            const randomX = box.x + paddingX + (Math.random() * (box.width - (paddingX * 2)));
            const randomY = box.y + paddingY + (Math.random() * (box.height - (paddingY * 2)));

            // Arahkan kursor menuju titik acak tersebut dengan lintasan halus
            await this.humanMouseMove(randomX, randomY);
            await GeneralUtils.randomSleep(200, 500); // Jeda sesaat setelah mouse sampai
        }
        await GeneralUtils.humanClick(this.page, locator);
    }

    public async getCurrentBalance() {
        const accountBalanceElement = this.page.locator('#headerAccount');
        if (await accountBalanceElement.count()) {
            const balanceText = await accountBalanceElement.first().innerText().catch(() => '');
            const parsed = parseInt(balanceText.replaceAll(',', '').trim(), 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }

        const accountLabel = this.page.getByText('Account', { exact: true }).first();
        if (await accountLabel.count()) {
            const balanceText = await accountLabel.locator('..').locator('div').first().innerText().catch(() => '');
            const parsed = parseInt(balanceText.replaceAll(',', '').replace(/[^0-9]/g, '').trim(), 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }

        return 0;
    }

    public async buyFuel() {
        console.log('Verificando compra de combustivel...')

        const fuelInput = this.page.getByPlaceholder('Amount to purchase');

        const getCurrentFuelPrice = async () => {
            let fuelText = await this.page.getByText('Total price$').locator('b > span').innerText();
            fuelText = fuelText.replaceAll(',', '');
            return parseInt(fuelText);
        }

        const getCurrentFuelUnitPrice = async () => {
            // Gerakkan kursor acak dan klik input box
            await this.moveAndClick(fuelInput);
            await GeneralUtils.randomSleep(500, 1200);

            await fuelInput.press('Control+a');
            await GeneralUtils.randomSleep(400, 900);
            await fuelInput.pressSequentially('1000', { delay: Math.floor(Math.random() * 80) + 40 });
            await GeneralUtils.randomSleep(800, 1400);

            const totalPrice = await getCurrentFuelPrice();
            return totalPrice > 0 ? totalPrice : 0;
        }

        const getCurrentHolding = async () => {
            let holdingText = await this.page.locator('#holding').innerText();
            holdingText = holdingText.replaceAll(',', '');
            return parseInt(holdingText);
        }

        const getEmptyFuel = async () => {
            const emptyText = (await this.page.locator('#remCapacity').innerText()).replaceAll(',', '')
            return parseInt(emptyText);
        }

        const getCurrentBalance = async () => {
            const accountBalanceElement = this.page.locator('#headerAccount');
            try {
                await accountBalanceElement.first().waitFor({ state: 'visible', timeout: 10000 });
            } catch {
                // fallback jika element header account tidak merespon cepat
            }

            if (await accountBalanceElement.count()) {
                const balanceText = await accountBalanceElement.first().innerText().catch(() => '');
                const parsed = parseInt(balanceText.replaceAll(',', '').trim(), 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    return parsed;
                }
            }

            const accountLabel = this.page.getByText('Account', { exact: true }).first();
            if (await accountLabel.count()) {
                const balanceText = await accountLabel.locator('..').locator('div').first().innerText().catch(() => '');
                const parsed = parseInt(balanceText.replaceAll(',', '').replace(/[^0-9]/g, '').trim(), 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    return parsed;
                }
            }

            return 0;
        }

        const currentBalance = await getCurrentBalance();
        console.log('Saldo atual: ' + currentBalance);

        const emptyFuel = await getEmptyFuel();
        if(emptyFuel === 0) {
            console.log('Tanque de combustivel ja esta cheio.');
            return;
        }

        const unitPrice = await getCurrentFuelUnitPrice();
        const curHolding = await getCurrentHolding();

        console.log('Preco atual do combustivel (por 1.000 L): ' + unitPrice);
        console.log('Saldo atual: ' + currentBalance);

        const calculatePurchaseAmount = (capacity: number, balance: number, pricePer1000Liters: number) => {
            if (pricePer1000Liters <= 0 || balance <= 0) {
                return 0;
            }

            const fullCostForCapacity = (capacity / 1000) * pricePer1000Liters;
            if (balance >= fullCostForCapacity) {
                return capacity;
            }

            const halfBudget = Math.floor(balance / 2);
            const affordableLiters = Math.floor((halfBudget / pricePer1000Liters) * 1000);
            return Math.max(0, Math.min(capacity, affordableLiters));
        }

        const fillFuel = async (amountToBuy: number, label: string) => {
            const configuredLimit = Number(process.env.MAX_FUEL_PURCHASE_PER_RUN || '0');
            if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
                amountToBuy = Math.min(amountToBuy, Math.floor(configuredLimit));
            }
            amountToBuy = Math.min(amountToBuy, emptyFuel);
            if (amountToBuy <= 0) {
                console.log('Compra de combustivel ignorada: quantidade zero ou saldo insuficiente.');
                return;
            }

            // Gerakkan kursor acak menuju kotak input
            await this.moveAndClick(fuelInput);
            await GeneralUtils.randomSleep(500, 1200);

            await fuelInput.press('Control+a');
            await GeneralUtils.randomSleep(400, 900);

            await fuelInput.pressSequentially(amountToBuy.toString(), { delay: Math.floor(Math.random() * 80) + 40 });
            await GeneralUtils.randomSleep(1000, 2000);

            // Gerakkan kursor acak menuju ke tombol Purchase
            const purchaseButton = this.page.getByRole('button', { name: ' Purchase' });
            await this.moveAndClick(purchaseButton);
            
            console.log(`Combustivel comprado. Quantidade: ${amountToBuy} litros${label}`);
        }

        if(unitPrice > 0 && unitPrice < this.maxFuelPrice) {
            const purchaseAmount = calculatePurchaseAmount(emptyFuel, currentBalance, unitPrice);
            await fillFuel(purchaseAmount, '');
        }
        else if(curHolding < 2000000 && unitPrice > 0 && unitPrice < 1250) {
            const suggestedAmount = 2000000;
            const purchaseAmount = calculatePurchaseAmount(suggestedAmount, currentBalance, unitPrice);
            await fillFuel(purchaseAmount, ' (compra emergencial)');
        } 
    }

    public async buyCo2() {
        console.log('Verificando compra de CO2...')

        const purchaseInput = this.page.getByPlaceholder('Amount to purchase');

        const getCurrentCo2Price = async () => {
            let co2Text = await this.page.getByText('Total price$').locator('b > span').innerText();
            co2Text = co2Text.replaceAll(',', '');
            return parseInt(co2Text);
        }

        const getCurrentHolding = async () => {
            let holdingText = await this.page.locator('#holding').innerText();
            holdingText = holdingText.replaceAll(',', '');
            return parseInt(holdingText);
        }

        const getEmptyCO2 = async () => {
            const emptyText = (await this.page.locator('#remCapacity').innerText()).replaceAll(',', '')
            return parseInt(emptyText);
        }

        const emptyCo2 = await getEmptyCO2();
        if(emptyCo2 === 0) {
            console.log('Reservatorio de CO2 ja esta cheio.');
            return;
        }

        const curCo2Price = await getCurrentCo2Price();
        const curHolding = await getCurrentHolding();

        console.log('Preco atual do CO2: ' + curCo2Price);

        // Limitar a quantidade comprada por execucao, se configurado.
        const rawCo2Limit = Number(process.env.MAX_CO2_PURCHASE_PER_RUN || '0');
        const co2Limit = Number.isFinite(rawCo2Limit) && rawCo2Limit > 0
            ? Math.floor(rawCo2Limit) : emptyCo2;

        if(curCo2Price > 0 && curCo2Price < this.maxCo2Price) {
            const emptyCo2Capacity = String(Math.min(emptyCo2, co2Limit));

            // Gerakkan kursor secara halus dan acak ke input box
            await this.moveAndClick(purchaseInput);
            await GeneralUtils.randomSleep(500, 1200);
            
            await purchaseInput.press('Control+a');
            await GeneralUtils.randomSleep(400, 900);
            
            await purchaseInput.pressSequentially(emptyCo2Capacity, { delay: Math.floor(Math.random() * 80) + 40 });
            await GeneralUtils.randomSleep(1000, 2000);
            
            // Gerakkan kursor secara halus dan acak menuju tombol Purchase CO2
            const purchaseButton = this.page.getByRole('button', { name: ' Purchase' });
            await this.moveAndClick(purchaseButton);

            console.log('CO2 comprado. Quantidade: ' + emptyCo2Capacity);
        }
        // Kondisi darurat jika emisi kritis
        else if(curHolding < 1000000 && curCo2Price > 0 && curCo2Price < 180) {
            const emergencyAmount = Math.min(emptyCo2, co2Limit, 1000000);
            if (emergencyAmount <= 0) return;
            await this.moveAndClick(purchaseInput);
            await GeneralUtils.randomSleep(500, 1200);
            
            await purchaseInput.press('Control+a');
            await GeneralUtils.randomSleep(400, 900);
            
            await purchaseInput.pressSequentially(emergencyAmount.toString(), { delay: Math.floor(Math.random() * 80) + 40 });
            await GeneralUtils.randomSleep(1000, 2000);
            
            const purchaseButton = this.page.getByRole('button', { name: ' Purchase' });
            await this.moveAndClick(purchaseButton);

            console.log('CO2 comprado. Quantidade: ' + emergencyAmount + ' (compra emergencial)');
        }
    }
}
