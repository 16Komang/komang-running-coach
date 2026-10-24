# PaceCoach MVP

Prototipe web mobile-first AI Running Coach dengan:
- Connect Strava melalui OAuth
- Sinkronisasi awal hingga 30 aktivitas terbaru
- Endpoint webhook Strava untuk create/update/delete aktivitas
- Dashboard volume, aktivitas, pace, program mingguan, dan insight berbasis aturan
- Target lari: konsistensi, 5K, 10K, half marathon, marathon, kebugaran umum
- Adaptasi program konservatif sederhana untuk demo

> Status: MVP awal untuk pengembangan lokal, bukan aplikasi produksi. Data disimpan pada `data.json` lokal dan tidak memiliki multi-user/auth aplikasi. Jangan deploy untuk banyak pengguna tanpa menambah autentikasi, database, enkripsi token, queue, audit log, dan kontrol akses.

## 1. Persyaratan
- Node.js 20 atau lebih baru
- Akun Strava dan akses membuat aplikasi API: https://www.strava.com/settings/api
- Untuk webhook: URL HTTPS publik (misalnya deployment server atau tunnel HTTPS saat pengembangan)

## 2. Jalankan lokal tanpa Strava
```bash
npm install
cp .env.example .env
npm start
```
Buka http://localhost:3000. Dashboard dapat dibuka, tetapi integrasi Strava baru aktif setelah konfigurasi API.

Di Windows PowerShell, salin `.env.example` menjadi `.env` secara manual jika perintah `cp` tidak tersedia.

## 3. Konfigurasikan Strava OAuth
Di Strava API settings:
1. Buat aplikasi Strava.
2. Atur Authorization Callback Domain ke domain yang digunakan. Untuk localhost, gunakan `localhost` saat pengembangan lokal.
3. Isi `.env`:
   - `STRAVA_CLIENT_ID`
   - `STRAVA_CLIENT_SECRET`
   - `STRAVA_VERIFY_TOKEN` (buat string acak yang panjang)
   - `BASE_URL` (alamat publik HTTPS saat dipasang di internet; lokal bisa `http://localhost:3000` untuk OAuth, tetapi webhook perlu URL publik HTTPS)
4. Restart server.
5. Klik **Hubungkan Strava** pada dashboard dan berikan izin yang diminta.

Jangan pernah commit `.env`, client secret, access token, atau refresh token ke Git.

## 4. Aktifkan webhook Strava
Strava mengirim GET untuk memvalidasi callback dan POST untuk event. Endpoint tersedia di:
- `GET /webhooks/strava`
- `POST /webhooks/strava`

Pastikan `BASE_URL` adalah URL HTTPS publik dan `STRAVA_VERIFY_TOKEN` sudah diisi. Buat subscription satu kali per aplikasi dengan:
```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F "client_id=YOUR_CLIENT_ID" \
  -F "client_secret=YOUR_CLIENT_SECRET" \
  -F "callback_url=https://YOUR-PUBLIC-DOMAIN/webhooks/strava" \
  -F "verify_token=YOUR_VERIFY_TOKEN"
```
Gunakan nilai yang sama dengan `.env`. Jangan membagikan client secret. Subscription akan memicu GET verifikasi ke endpoint tersebut. Periksa dokumentasi resmi: https://developers.strava.com/docs/webhooks/

Webhook hanya mengirim metadata event; server mengambil detail aktivitas terbaru melalui API. Server memberi respons 200 dengan cepat lalu memproses event secara asinkron.

## 5. Perilaku coaching MVP
- Menghitung jumlah sesi dan total jarak lari 7 hari terakhir.
- Menghitung perbandingan volume 7 hari terakhir dengan 7 hari sebelumnya.
- Menandai kenaikan volume >25% sebagai sinyal untuk berhati-hati; ini adalah heuristik sederhana, bukan ambang medis universal.
- Tombol "Sesuaikan program berikutnya" membuat ulang template mingguan. Jika volume naik tajam, target jarak template diturunkan 15%.
- Rekomendasi tidak menggunakan data cedera, tidur, RPE, cuaca, atau HRV; jangan gunakan sebagai nasihat medis atau rencana latihan personal yang sudah tervalidasi.

## 6. Batasan penting sebelum produksi
1. Data saat ini hanya disimpan di satu file JSON. Restart server mempertahankan data, tetapi ini tidak cocok untuk multi-user atau serverless.
2. OAuth token disimpan lokal tanpa enkripsi. Ganti dengan database dan enkripsi/secret management.
3. Tidak ada login aplikasi, role coach/runner, CSRF protection, rate limiting, atau job queue durable.
4. Aplikasi Strava baru berada pada Single Player Mode secara default; perlu akses yang sesuai untuk menghubungkan lebih banyak atlet. Periksa API Settings dan kebijakan Strava terbaru.
5. Webhook Strava memiliki satu subscription per aplikasi. Proses event idempotently dan pantau retry.
6. `activity:read_all` diminta agar pengguna dapat mengizinkan aktivitas privat; pengguna bisa menolak atau memberikan izin yang lebih terbatas.
7. Strava API dan ketentuan penggunaan dapat berubah. Tinjau API policy, brand guidelines, dan aturan penayangan data sebelum meluncurkan.
8. Integrasi Garmin langsung belum dibuat; jika Garmin tersinkron ke Strava, aktivitas yang masuk ke Strava dapat mengikuti alur ini sesuai izin dan visibilitasnya.

## 7. Referensi
- https://developers.strava.com/docs/getting-started/
- https://developers.strava.com/docs/webhooks/
- https://developers.strava.com/docs/rate-limits/
- https://www.strava.com/legal/api_policy
