import { Page } from "@playwright/test";
import { GeneralUtils } from "./general.utils";

require('dotenv').config();

export class MaintenanceUtils {
    page: Page;
    repairWear: string;
    hoursCheck: number;

    constructor(page: Page) {
        this.page = page;

        const configuredRepairWear = parseInt(process.env.REPAIR_WEAR || '30', 10);
        const configuredHoursCheck = parseInt(process.env.HOURS_CHECK || '20', 10);

        this.repairWear =
            Number.isFinite(configuredRepairWear) && configuredRepairWear > 0
                ? String(configuredRepairWear)
                : '30';
        this.hoursCheck =
            Number.isFinite(configuredHoursCheck) && configuredHoursCheck >= 0
                ? configuredHoursCheck
                : 20;
    }

    /**
     * Helper privat untuk membuka panel perencanaan.
     * Menggunakan moveAndClick global untuk menjamin lintasan melengkung dan pendaratan acak.
     */
    private async openPlanPanel() {
        const planButton = this.page.getByRole('button', { name: ' Plan' });
        await planButton.waitFor({ state: 'visible', timeout: 15000 });
        
        // Panggil utilitas terpusat untuk simulasi gerak dan klik manusiawi
        await GeneralUtils.moveAndClick(this.page, planButton);
    }

    /**
     * 🛠️ FITUR BARU: SELEKSI DROP-DOWN MANUSIAWI (ANTI-TELEPORTASI)
     * Menyimulasi tindakan manusia memilih opsi: Bergerak ke kotak drop-down, mengkliknya,
     * menunggu panel opsi muncul di layar (jeda mata membaca), lalu memilih opsi target.
     */
    private async moveAndSelectOption(selectLocator: any, optionValue: string) {
        // 1. Gerakkan mouse secara halus dan klik kotak drop-down utama untuk membukanya
        await GeneralUtils.moveAndClick(this.page, selectLocator);
        
        // 2. ⏱️ JEDA PSIKOLOGIS: Meniru waktu yang dibutuhkan mata dan otak manusia untuk mencari opsi
        await GeneralUtils.randomSleep(700, 1400); 

        // 3. Eksekusi pemilihan opsi secara sinkron setelah UI-nya terpicu terbuka secara fisik
        await selectLocator.selectOption(optionValue);
        
        // Jeda sesaat seolah-olah manusia melepas fokus dari menu drop-down tersebut
        await GeneralUtils.randomSleep(500, 900);
    }

    /**
     * Menyimulasi pergerakan scroll manusia yang acak (chaotic smooth scrolling).
     * Bisa mendadak cepat, pelan, putus-putus, bahkan kelewatan lalu naik lagi.
     */
    private async chaoticHumanScroll(targetY: number) {
        const steps = Math.floor(Math.random() * 4) + 3; 
        const totalDistance = targetY > 0 ? targetY + 100 : targetY - 100; 
        const baseDelta = totalDistance / steps;

        for (let j = 0; j < steps; j++) {
            let deltaY = baseDelta;
            let delay = Math.floor(Math.random() * 100) + 50; 

            await this.page.mouse.wheel(0, deltaY);
            await this.page.waitForTimeout(delay);
        }
    }

    private async humanScrollToElement(element: any) {
        const box = await element.boundingBox();
        const viewport = this.page.viewportSize();

        if (box && viewport) {
            if (box.y + box.height > viewport.height || box.y < 0) {
                const targetY = box.y < 0 ? box.y - 50 : (box.y + box.height) - viewport.height + 100;
                await this.chaoticHumanScroll(targetY);
                await GeneralUtils.randomSleep(500, 1000);
            }
        }
    }

    /**
     * Melakukan scroll balik ke atas secara penuh (mentok) secara bertahap.
     */
    private async scrollBackToTop() {
        console.log("Voltando ao topo do painel de manutencao...");
        const upSteps = Math.floor(Math.random() * 3) + 4; // 4 sampai 6 kali usapan ke atas
        for (let k = 0; k < upSteps; k++) {
            const scrollAmount = -(Math.floor(Math.random() * 200) + 200); 
            await this.page.mouse.wheel(0, scrollAmount);
            await GeneralUtils.randomSleep(100, 250); 
        }
        await GeneralUtils.randomSleep(800, 1500); 
    }

    public async repairPlanes():Promise<{repairEligible:boolean}> {
        await this.openPlanPanel();
        await GeneralUtils.randomSleep(1000, 2000);
        
        // Upgrade tombol bulk repair menggunakan moveAndClick terpusat
        const bulkRepairButton = this.page.getByRole('button', { name: ' Bulk repair' });
        await GeneralUtils.moveAndClick(this.page, bulkRepairButton);
        await GeneralUtils.randomSleep(1200, 2200);
        
        // --- 🚀 PROSES SELEKSI OPSI SECARA HUMAN-LIKE BERAKSI ---
        console.log(`Selecionando limite de desgaste para reparo: ${this.repairWear}%...`);
        const repairPercentSelect = this.page.locator('#repairPct');
        await this.moveAndSelectOption(repairPercentSelect, this.repairWear);
        await GeneralUtils.randomSleep(1200, 2500);
        
        const noPlaneExists = await this.page.getByText('There are no aircraft worn to').isVisible();
        if (!noPlaneExists) {
            // Upgrade tombol final perbaikan massal menggunakan moveAndClick terpusat
            const planBulkRepairButton = this.page.getByRole('button', { name: 'Plan bulk repair' });
            await GeneralUtils.moveAndClick(this.page, planBulkRepairButton);
        }
        return {repairEligible:!noPlaneExists};
    }

    public async checkPlanes():Promise<{evaluated:number;selected:number;bulkCheckExecuted:boolean}> {
        await this.openPlanPanel();
        await GeneralUtils.randomSleep(1000, 2000);
        
        // Upgrade tombol bulk check menggunakan moveAndClick terpusat
        const bulkCheckButton = this.page.getByRole('button', { name: ' Bulk check' });
        await GeneralUtils.moveAndClick(this.page, bulkCheckButton);
        
        await GeneralUtils.randomSleep(3000, 4500);
        
        let clicked = false;
        let selected = 0;
        let didScroll = false; 

        // 🚀 STRATEGI UTAMA 1: Pre-Scroll ke bawah panel agar seluruh kartu pesawat (.bg-white) termuat penuh di layar
        console.log("[Manutencao] Percorrendo painel para carregar todas as aeronaves...");
        for (let s = 0; s < 5; s++) {
            await this.page.mouse.wheel(0, 450);
            await GeneralUtils.randomSleep(200, 450);
        }
        await GeneralUtils.randomSleep(1000, 1500);

        // Scroll balik ke paling atas terlebih dahulu agar perhitungan indeks kartu dimulai dengan benar
        await this.page.mouse.wheel(0, -2500);
        await GeneralUtils.randomSleep(800, 1200);

        // Ambil jumlah total elemen kartu pesawat `.bg-white` saat pertama kali dimuat
        let cardsCount = await this.page.locator('.bg-white').count();
        console.log(`[Manutencao] Avaliando ${cardsCount} aeronaves (limite: ate ${this.hoursCheck} horas)...`);

        // 🚀 STRATEGI UTAMA 2: Jalankan loop satu arah langsung dari indeks 0 hingga akhir
        for (let i = 0; i < cardsCount; i++) {
            // 🔄 AMBIL ULANG LOCATOR DI SETIAP ITERASI (Mencegah Stale Element Reference setelah klik pertama)
            const cardElement = this.page.locator('.bg-white').nth(i);
            
            // Pengaman: Tunggu kartu terpasang dengan benar di DOM sebelum mengecek isinya
            try {
                await cardElement.waitFor({ state: 'attached', timeout: 3000 });
            } catch (e) {
                console.log(`[Aviso] Aeronave de indice ${i} indisponivel. Continuando para a proxima.`);
                continue;
            }

            // Jika kartu belum masuk ke area layar aktif, scroll perlahan ke posisinya
            if (!(await cardElement.isVisible())) {
                await cardElement.scrollIntoViewIfNeeded();
                await GeneralUtils.randomSleep(300, 600);
                if (!(await cardElement.isVisible())) continue;
            }

            // Ambil text isi kartu secara keseluruhan untuk membaca sisa jam terbang
            const cardText = await cardElement.innerText();
            
            // Deteksi apakah teks jam terbang di dalam kartu ini sudah menyala merah (.text-danger)
            const hasDangerText = await cardElement.locator('.text-danger').count() > 0;
            
            // 🚀 PERBAIKAN REGEX BARU: Menangkap angka jam yang berada di BARIS BARU tepat setelah kalimat "Hours to check"
            const hourMatch = cardText.match(/hours\s*to\s*check\s*[\r\n\s]*(\d+)/i) || cardText.match(/(\d+)\s*(?=hr|hour|jam)/i);
            let hoursRemaining = null; 
            
            if (hourMatch) {
                hoursRemaining = parseInt(hourMatch[1], 10);
            } else {
                // Jalur cadangan jika teks "Hours to check" berganti bahasa, ambil angka pertama pada kartu
                const backupMatch = cardText.match(/\d+/);
                if (backupMatch) hoursRemaining = parseInt(backupMatch[0], 10);
            }

            // --- 📌 STRUKTUR LOGIKA PRIORITAS ---
            let harusDiCheck = false;
            let alasan = "";

            if (hoursRemaining !== null) {
                // PRIORITAS UTAMA: Jika nilai angka teks berhasil dibaca, jadikan acuan mutlak (Hijau/Merah bernilai sama)
                if (hoursRemaining <= this.hoursCheck) {
                    harusDiCheck = true;
                    alasan = `Restam ${hoursRemaining} horas (limite de ${this.hoursCheck} horas) [Leitura do painel]`;
                }
            } else if (hasDangerText) {
                // PRIORITAS CADANGAN: Hanya jika teks angka gagal terbaca sama sekali, gunakan warna merah sebagai fallback
                harusDiCheck = true;
                alasan = "Nao foi possivel ler as horas, mas foi identificado um alerta vermelho.";
            }

            // Eksekusi klik jika memenuhi syarat evaluasi di atas
            if (harusDiCheck) {
                console.log(`[Preventivo] Selecionada aeronave de indice ${i} pelo motivo: ${alasan}`);

                // Pastikan elemen berada di posisi tengah layar yang aman sebelum diklik oleh mouse virtual
                await cardElement.scrollIntoViewIfNeeded();
                await GeneralUtils.randomSleep(400, 800);

                const boxBefore = await cardElement.boundingBox();
                const viewport = this.page.viewportSize();
                if (boxBefore && viewport && (boxBefore.y + boxBefore.height > viewport.height || boxBefore.y < 0)) {
                    didScroll = true; 
                }

                // Gerakkan kursor ke kartu pesawat secara halus dan klik secara acak di area aman kartu
                await GeneralUtils.moveAndClick(this.page, cardElement);
                clicked = true;
                selected++;

                // Jeda ketukan jari manusia antar klik pesawat agar aman dari Anti-Cheat game dan menunggu DOM stabil
                await GeneralUtils.randomSleep(1500, 2500);
            }
        }

        if (clicked) {
            if (didScroll) {
                await this.scrollBackToTop();
            } else {
                await GeneralUtils.randomSleep(1000, 2000);
            }
            
            // Upgrade tombol final bulk check menggunakan moveAndClick terpusat
            const planBulkCheckButton = this.page.getByRole('button', { name: 'Plan bulk check' });
            await GeneralUtils.moveAndClick(this.page, planBulkCheckButton);
            console.log("[Manutencao] Verificacoes em lote executadas.");
        } else {
            console.log("[Preventivo] Finalizado. Aeronaves acima do limite de horas para revisao.");
        }
        return {evaluated:cardsCount,selected,bulkCheckExecuted:clicked};
    }
}

