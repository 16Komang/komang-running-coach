require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DATA_FILE = path.join(__dirname, "data.json");
const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH = "https://www.strava.com/oauth";

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function readStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { token: null, athlete: null, activities: [], plan: defaultPlan(), lastSync: null, webhookEvents: [] };
    }
    const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { token: null, athlete: null, activities: [], plan: defaultPlan(), lastSync: null, webhookEvents: [], ...d };
  } catch (e) {
    console.error("Could not read data store:", e.message);
    return { token: null, athlete: null, activities: [], plan: defaultPlan(), lastSync: null, webhookEvents: [] };
  }
}
let store = readStore();
function saveStore() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}
function defaultPlan() {
  const start = new Date();
  start.setHours(0,0,0,0);
  const days = [
    { offset: 0, type: "Easy Run", distance_km: 4, notes: "Lari santai; masih bisa berbicara." },
    { offset: 1, type: "Rest / Mobility", distance_km: 0, notes: "Istirahat atau mobilitas ringan." },
    { offset: 2, type: "Quality Session", distance_km: 4, notes: "Pemanasan, latihan terkontrol, lalu pendinginan." },
    { offset: 3, type: "Rest / Easy Walk", distance_km: 0, notes: "Pulihkan tubuh." },
    { offset: 4, type: "Easy Run", distance_km: 4, notes: "Jaga intensitas tetap ringan." },
    { offset: 5, type: "Rest", distance_km: 0, notes: "Istirahat." },
    { offset: 6, type: "Long Easy Run", distance_km: 6, notes: "Lari santai, jangan mengejar pace." }
  ];
  return {
    goal: "Konsistensi lari",
    goalDistanceKm: 10,
    days: days.map(d => {
      const date = new Date(start); date.setDate(date.getDate() + d.offset);
      return { date: date.toISOString().slice(0,10), type: d.type, target_distance_km: d.distance_km, target_pace_min_km: null, notes: d.notes, status: "planned" };
    }),
    updatedAt: new Date().toISOString()
  };
}
function paceText(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "—";
  const s = Math.round(secondsPerKm);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}/km`;
}
function normalizeActivity(a) {
  const distance = Number(a.distance || 0);
  const moving = Number(a.moving_time || a.elapsed_time || 0);
  return {
    id: String(a.id),
    name: a.name || "Run",
    sport_type: a.sport_type || a.type || "Run",
    start_date: a.start_date || a.start_date_local || null,
    distance_m: distance,
    distance_km: Math.round(distance / 10) / 100,
    moving_time_s: moving,
    elapsed_time_s: Number(a.elapsed_time || moving),
    average_speed_m_s: Number(a.average_speed || 0),
    average_pace_s_km: distance > 0 ? moving / (distance / 1000) : null,
    average_heartrate: a.average_heartrate ?? null,
    total_elevation_gain: a.total_elevation_gain ?? null,
    strava_url: `https://www.strava.com/activities/${a.id}`,
    synced_at: new Date().toISOString()
  };
}
function isRun(a) {
  return ["Run", "TrailRun", "VirtualRun"].includes(a.sport_type);
}
function analyzeTraining(activities, plan) {
  const runs = activities.filter(a => ["Run","TrailRun","VirtualRun"].includes(a.sport_type));
  const now = Date.now();
  const last7 = runs.filter(a => a.start_date && now - new Date(a.start_date).getTime() <= 7*86400000);
  const prev7 = runs.filter(a => a.start_date && now - new Date(a.start_date).getTime() > 7*86400000 && now - new Date(a.start_date).getTime() <= 14*86400000);
  const km7 = last7.reduce((s,a) => s + a.distance_km, 0);
  const kmPrev = prev7.reduce((s,a) => s + a.distance_km, 0);
  const recent = [...runs].sort((a,b) => new Date(b.start_date)-new Date(a.start_date)).slice(0,5);
  const averagePace = recent.filter(a => a.average_pace_s_km).length
    ? recent.filter(a => a.average_pace_s_km).reduce((s,a)=>s+a.average_pace_s_km,0) / recent.filter(a=>a.average_pace_s_km).length
    : null;
  let status = "Build consistency";
  let recommendation = "Pertahankan jadwal yang realistis. Tambah beban secara bertahap dan sisipkan hari pemulihan.";
  if (last7.length === 0) {
    status = "No recent run";
    recommendation = "Belum ada aktivitas lari 7 hari terakhir. Mulai dengan sesi ringan sesuai kondisi tubuh; jangan mengganti sesi yang terlewat dengan latihan berat.";
  } else if (kmPrev > 0 && km7 > kmPrev * 1.25) {
    status = "Load increased";
    recommendation = "Volume 7 hari terakhir naik lebih dari 25% dibanding 7 hari sebelumnya. Pertimbangkan mempertahankan atau mengurangi beban minggu depan dan prioritaskan pemulihan.";
  } else if (last7.length >= 2) {
    status = "Consistent";
    recommendation = "Konsistensi terlihat baik. Jika tubuh terasa pulih dan tidak ada nyeri, lanjutkan program secara bertahap; jangan menaikkan volume dan intensitas sekaligus.";
  }
  return {
    run_count_7d: last7.length,
    distance_km_7d: Math.round(km7*100)/100,
    previous_distance_km_7d: Math.round(kmPrev*100)/100,
    average_pace_s_km_recent: averagePace ? Math.round(averagePace) : null,
    average_pace_text: paceText(averagePace),
    status,
    recommendation,
    note: "Rekomendasi berbasis aturan sederhana untuk MVP, bukan diagnosis atau pengganti pelatih/tenaga medis."
  };
}
async function stravaFetch(url, options = {}) {
  if (!store.token) throw new Error("Strava belum terhubung.");
  await ensureFreshToken();
  const resp = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${store.token.access_token}` }
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Strava API ${resp.status}: ${body.slice(0,300)}`);
  }
  return resp.json();
}
async function ensureFreshToken() {
  if (!store.token) return;
  if (Number(store.token.expires_at) > Math.floor(Date.now()/1000) + 120) return;
  const body = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID || "",
    client_secret: process.env.STRAVA_CLIENT_SECRET || "",
    grant_type: "refresh_token",
    refresh_token: store.token.refresh_token || ""
  });
  const resp = await fetch(`${STRAVA_OAUTH}/token`, { method: "POST", body });
  if (!resp.ok) throw new Error(`Gagal memperbarui token Strava (${resp.status}). Hubungkan ulang bila perlu.`);
  const data = await resp.json();
  store.token = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
  saveStore();
}
async function syncActivity(activityId, ownerId) {
  if (!store.token || !store.athlete) return;
  if (ownerId && Number(ownerId) !== Number(store.athlete.id)) return;
  const raw = await stravaFetch(`${STRAVA_API}/activities/${encodeURIComponent(activityId)}`);
  const normalized = normalizeActivity(raw);
  store.activities = store.activities.filter(a => a.id !== normalized.id);
  if (isRun(normalized)) store.activities.unshift(normalized);
  store.activities.sort((a,b) => new Date(b.start_date)-new Date(a.start_date));
  store.lastSync = new Date().toISOString();
  saveStore();
}
function addEvent(evt) {
  store.webhookEvents.unshift({ received_at: new Date().toISOString(), event: evt });
  store.webhookEvents = store.webhookEvents.slice(0,20);
  saveStore();
}

app.get("/api/health", (req,res) => res.json({ ok: true, app: "PaceCoach MVP", stravaConnected: !!store.token }));
app.get("/api/state", (req,res) => {
  const analysis = analyzeTraining(store.activities, store.plan);
  res.json({
    app: "PaceCoach",
    connected: !!store.token,
    athlete: store.athlete ? { id: store.athlete.id, firstname: store.athlete.firstname, lastname: store.athlete.lastname, profile: store.athlete.profile } : null,
    activities: store.activities.slice(0,30),
    plan: store.plan,
    analysis,
    lastSync: store.lastSync,
    recentWebhookEvents: store.webhookEvents.slice(0,5)
  });
});
app.get("/auth/strava", (req,res) => {
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) return res.status(400).send("Isi STRAVA_CLIENT_ID dan STRAVA_CLIENT_SECRET di .env terlebih dahulu.");
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${BASE_URL}/auth/strava/callback`,
    approval_prompt: "auto",
    scope: "read,activity:read_all"
  });
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});
app.get("/auth/strava/callback", async (req,res) => {
  try {
    if (req.query.error) return res.status(400).send(`Otorisasi ditolak: ${String(req.query.error)}`);
    const body = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID || "",
      client_secret: process.env.STRAVA_CLIENT_SECRET || "",
      code: String(req.query.code || ""),
      grant_type: "authorization_code"
    });
    const resp = await fetch(`${STRAVA_OAUTH}/token`, { method: "POST", body });
    const data = await resp.json();
    if (!resp.ok) return res.status(400).send(`Strava OAuth gagal: ${JSON.stringify(data)}`);
    store.token = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
    store.athlete = data.athlete;
    store.activities = [];
    saveStore();
    try {
      const recent = await stravaFetch(`${STRAVA_API}/athlete/activities?per_page=30&page=1`);
      store.activities = recent.map(normalizeActivity).filter(isRun).sort((a,b)=>new Date(b.start_date)-new Date(a.start_date));
      store.lastSync = new Date().toISOString();
      saveStore();
    } catch (e) { console.error("Initial activity sync failed:", e.message); }
    res.redirect("/");
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal menghubungkan Strava. Periksa konfigurasi server.");
  }
});
app.post("/api/disconnect", (req,res) => {
  store.token = null; store.athlete = null; store.activities = []; store.lastSync = null; saveStore();
  res.json({ ok: true });
});
app.post("/api/plan", (req,res) => {
  const goal = String(req.body.goal || "Konsistensi lari").slice(0,120);
  const goalDistanceKm = Math.min(100, Math.max(1, Number(req.body.goalDistanceKm || 10)));
  store.plan = { ...store.plan, goal, goalDistanceKm, updatedAt: new Date().toISOString() };
  saveStore();
  res.json({ ok: true, plan: store.plan });
});
app.post("/api/plan/regenerate", (req,res) => {
  const old = store.plan || defaultPlan();
  const analysis = analyzeTraining(store.activities, old);
  const plan = defaultPlan();
  plan.goal = old.goal || "Konsistensi lari";
  plan.goalDistanceKm = old.goalDistanceKm || 10;
  // Conservative adaptation: reduce distance after a large recent load increase; otherwise preserve the template.
  if (analysis.status === "Load increased") {
    plan.days = plan.days.map(d => ({ ...d, target_distance_km: Math.round(d.target_distance_km * 0.85 * 10)/10 }));
  }
  plan.updatedAt = new Date().toISOString();
  plan.adaptationReason = analysis.recommendation;
  store.plan = plan;
  saveStore();
  res.json({ ok: true, plan, analysis });
});
app.post("/api/sync", async (req,res) => {
  try {
    if (!store.token) return res.status(400).json({ error: "Hubungkan Strava terlebih dahulu." });
    const recent = await stravaFetch(`${STRAVA_API}/athlete/activities?per_page=30&page=1`);
    const normalized = recent.map(normalizeActivity).filter(isRun);
    const map = new Map(store.activities.map(a => [a.id,a]));
    normalized.forEach(a => map.set(a.id,a));
    store.activities = [...map.values()].sort((a,b)=>new Date(b.start_date)-new Date(a.start_date)).slice(0,100);
    store.lastSync = new Date().toISOString();
    saveStore();
    res.json({ ok: true, count: store.activities.length, lastSync: store.lastSync });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Strava webhook verification: Strava calls GET during subscription setup.
app.get("/webhooks/strava", (req,res) => {
  const verifyToken = process.env.STRAVA_VERIFY_TOKEN || "";
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verifyToken) {
    return res.status(200).json({ "hub.challenge": req.query["hub.challenge"] });
  }
  return res.sendStatus(403);
});
// Acknowledge quickly, then process asynchronously (Strava expects a 200 quickly).
app.post("/webhooks/strava", (req,res) => {
  const evt = req.body || {};
  addEvent(evt);
  res.sendStatus(200);
  setImmediate(async () => {
    try {
      if (evt.object_type === "activity" && ["create","update"].includes(evt.aspect_type)) {
        await syncActivity(evt.object_id, evt.owner_id);
      } else if (evt.object_type === "activity" && evt.aspect_type === "delete") {
        store.activities = store.activities.filter(a => a.id !== String(evt.object_id));
        store.lastSync = new Date().toISOString();
        saveStore();
      } else if (evt.object_type === "athlete" && evt.updates && evt.updates.authorized === "false") {
        store.token = null; store.athlete = null; store.activities = []; saveStore();
      }
    } catch (e) { console.error("Webhook processing error:", e.message); }
  });
});

app.get("/api/setup-status", (req,res) => res.json({
  baseUrl: BASE_URL,
  clientConfigured: !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
  verifyTokenConfigured: !!process.env.STRAVA_VERIFY_TOKEN,
  webhookUrl: `${BASE_URL}/webhooks/strava`,
  callbackUrl: `${BASE_URL}/auth/strava/callback`
}));

app.listen(PORT, () => {
  console.log(`PaceCoach MVP running at http://localhost:${PORT}`);
  console.log(`Public BASE_URL configured as: ${BASE_URL}`);
});
