# NetAcad AI & Auto-Submit Assistant (Manifest V3)

Ekstensi browser berbasis **Chromium (Google Chrome, Brave, Microsoft Edge)** dengan antarmuka **Soft Minimalist SVG** untuk membantu mendeteksi, menjawab otomatis, dan melakukan *auto-submit* soal kuis maupun ujian pada platform [Cisco Networking Academy](https://www.netacad.com/) dan [Skills For All](https://skillsforall.com/).

Dirancang khusus untuk menembus arsitektur *nested iframe* (`all_frames: true`), *Shadow DOM*, dan *horizontal carousel* pada *Adapt Learning Framework* yang digunakan oleh halaman kurikulum [Cisco Networking Academy](https://www.netacad.com/launch?id=06bf2b4c-2242-48bc-94be-70990a7e6205&tab=curriculum&view=93d40451-1f34-11ee-8fba-c19a3123a561).

## Fitur Utama

* **Strict 2D Viewport Scanner (Anti-Carousel Leak)**: Memindai hanya elemen soal dan opsi jawaban yang benar-benar tampil di tengah *viewport* aktif (`X` dan `Y`), sehingga slide soal sebelumnya yang tersembunyi secara horizontal di *DOM* (*carousel track*) tidak pernah ikut terbaca.
* **Toggle-Safe Multi-Choice & Single-Choice Clicking**: Mendukung soal pilihan tunggal (*radio button*) maupun pilihan ganda (*Choose two*, *Choose three*, *Choose four* berbasis *checkbox*) dengan verifikasi status centang (`isOptionSelected`) agar kotak *checkbox* tidak ter-reset akibat klik ganda.
* **Multi-Slot API Key dengan Auto-Fallback (`K1 -> K2 -> K3`)**: Menyediakan 3 slot penyimpanan API Key. Apabila **Slot K1** mencapai batas kuota (`HTTP 429`), sistem secara otomatis mengalihkan permintaan ke **Slot K2** lalu **Slot K3** tanpa menghentikan alur pengerjaan kuis, disertai mekanisme *cooldown* 60 detik per slot.
* **Mode Manual Pick + Auto-Submit (Berjalan Tanpa Kuota API)**: Tetap berfungsi penuh meskipun seluruh kuota API habis atau mode AI dimatikan. Saat pengguna mengklik sendiri opsi jawaban di layar (1 opsi untuk *radio*, atau sejumlah `N` opsi untuk soal *Choose two / Choose three*), ekstensi otomatis menekan tombol **Submit** dan **Next**.
* **4 Level Penghematan Kuota API (Token Saver)**: Mengatur konsumsi token mulai dari mode teks murni hingga mode *Vision HD* dan *Extended Thinking*.
* **Memori Cache Soal Lokal (`0 Kuota`)**: Menyimpan jawaban soal yang pernah diselesaikan ke dalam `chrome.storage.local` (`answerCache`). Saat halaman dimuat ulang atau kuis diulang, jawaban langsung diambil dari memori lokal tanpa memanggil API.
* **Expandable Detail & Explanation Drawer**: Menyediakan tombol **Detail** pada panel *Floating HUD* maupun *Popup* untuk melihat penjelasan lengkap alasan jawaban AI, sumber *Slot API Key* yang digunakan, serta detail diagnostik saat menguji koneksi API.

## Perbandingan 4 Level Kuota AI

| Level Kuota | Mode Tangkapan Layar (Vision) | Skema Prompt & Output | Estimasi Penghematan Token |
| :--- | :--- | :--- | :--- |
| **Eco (`LVL 1` - Default)** | Nonaktif (`0 Token Gambar`) | Prompt teks ringkas + output JSON padat | Hemat hingga ~95% kuota token |
| **Smart (`LVL 2`)** | Otomatis (Aktif hanya jika terdeteksi gambar, tabel, atau kata *exhibit*) | Prompt kontekstual + penjelasan singkat 1-2 kalimat | Hemat hingga ~85% kuota token |
| **Pro (`LVL 3`)** | Aktif (Kompresi JPEG 50% + sembunyikan HUD otomatis selama 60ms) | Prompt lengkap + alasan jawaban terstruktur | Hemat hingga ~50% kuota token |
| **Max (`LVL 4`)** | Aktif (Resolusi Tinggi JPEG 80%) | Analisis mendalam untuk soal topologi, *subnetting*, dan VLSM | Mode akurasi maksimal |

## Struktur Direktori Proyek

```text
netacad-ai-solver/
├── manifest.json       # Konfigurasi Manifest V3, izin storage/tabs/activeTab, dan all_frames
├── background.js       # Service worker: Multi-Key Fallback Engine, API Tester, Cache & Tab Capture
├── content.js          # 2D Viewport Scraper, Toggle-Safe Clicker, Manual Auto-Submit & Floating HUD
├── content.css         # Styling Soft Minimalist Frosted-Glass HUD dan highlight opsi
├── popup.html          # Struktur antarmuka Popup berbasis ubin ikon SVG (Icon Tiles)
├── popup.css           # Tema warna Soft Pastel Slate & Indigo untuk Popup
├── popup.js            # Kontroler konfigurasi, multi-slot API key, dan notifikasi tes koneksi
├── README.md           # Dokumentasi proyek
└── icons/              # Ikon ekstensi ukuran 16x16, 48x48, dan 128x128 piksel
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Cara Instalasi (Developer Mode)

1. **Unduh atau Clone Repositori**:
   ```bash
   git clone https://github.com/username/netacad-ai-solver.git
   ```
   *(Atau ekstrak file arsip `netacad-ai-solver-extension.zip` ke sebuah folder lokal di komputer Anda).*
2. **Buka Halaman Manajemen Ekstensi**:
   Buka browser berbasis Chromium dan akses alamat `chrome://extensions/` (atau `brave://extensions/` / `edge://extensions/`).
3. **Aktifkan Developer Mode**:
   Nyalakan sakelar **Developer mode** (Mode Pengembang) yang terletak di pojok kanan atas halaman.
4. **Muat Folder Ekstensi**:
   Klik tombol **Load unpacked** (Muat yang belum dikemas) di pojok kiri atas, kemudian pilih folder `netacad-ai-solver` yang berisi file `manifest.json`.

## Panduan Konfigurasi & Penggunaan

1. **Pengaturan API Key & Slot Fallback**:
   * Klik ikon **NetAcad Assistant** pada *toolbar* browser.
   * Pilih **Provider** (misalnya `Gemini 3`) dan **Model** (`3.8 Flash` atau `3.5 Flash-Lite`).
   * Masukkan API Key utama pada kolom **`K1`**.
   * Klik tombol ikon **`+`** di samping kolom `K1` untuk membuka dan mengisi slot cadangan **`K2`** serta **`K3`** (opsional, digunakan sebagai *auto-fallback* saat `K1` terkena limit kuota).
   * Klik tombol ikon **Centang** untuk menguji seluruh slot API Key sekaligus dan melihat status ketersediaan kuota maupun *latency* (`ms`) pada *banner* notifikasi.
2. **Pemilihan Mode Kerja**:
   * **AI Auto**: Mengaktifkan pemindaian soal otomatis, pemilihan opsi jawaban oleh AI, dan penekanan tombol **Submit** secara berkesinambungan dari soal pertama hingga selesai.
   * **Manual Submit**: Mengaktifkan pendeteksi klik manual—cukup klik sendiri opsi jawaban yang diinginkan pada layar kuis, dan ekstensi akan otomatis menekan tombol **Submit** begitu jumlah opsi yang dipilih sudah sesuai dengan instruksi soal (`1/1`, `2/2`, atau `3/3`).
3. **Panel Detail & Penjelasan (Expand)**:
   * Klik tombol **`Detail`** di sebelah kanan baris status pada *Floating HUD* di layar kuis (atau tombol **`Expand`** di dalam *Popup*) untuk membaca alasan jawaban AI secara lengkap dan melihat slot API Key mana yang memproses soal tersebut.

## Pintasan Papan Ketik (Keyboard Shortcuts)

| Pintasan Tombol | Fungsi Eksekusi di Halaman Kuis |
| :--- | :--- |
| **`Alt + S`** | Memindai soal aktif di layar dan langsung menjawab dengan AI (*Manual Trigger*) |
| **`Alt + A`** | Menyalakan atau menjeda mode **AI Auto-Solve** |
| **`Alt + H`** | Menyembunyikan atau menampilkan kembali panel **Floating HUD** (*Stealth Mode*) |

## Catatan Penggunaan

Ekstensi ini dibuat sebagai proyek pembelajaran eksplorasi *DOM Scraping*, pengelolaan *Web Components / Shadow DOM*, serta orkestrasi *Multi-Key API Failover* pada ekstensi Chrome berbasis Manifest V3. Gunakan secara bijak sebagai pendamping belajar dan verifikasi pemahaman materi jaringan.
