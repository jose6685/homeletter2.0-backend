require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("."));

// 補上 favicon.ico，避免瀏覽器預設請求造成 404 警告
app.get('/favicon.ico', (req, res) => {
  try {
    const svgPath = path.join(__dirname, 'favicon.svg');
    if (fs.existsSync(svgPath)) {
      const svg = fs.readFileSync(svgPath, 'utf8');
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
      return;
    }
  } catch {}
  // 若沒有檔案，回傳 204 以停止 404 噪音
  res.status(204).end();
});

// 只有在環境變數存在時才初始化 OpenAI，用於避免本機無金鑰時伺服器啟動失敗
let client = null;
if (process.env.OPENAI_API_KEY) {
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
const PORT = process.env.PORT || 3000;
const MAILBOX_PATH = path.join(__dirname, "mailbox.json");
const PROMPT_PATH = path.join(__dirname, "【OpenAI GPT-4.0 Mini 抽卡 Prompt - 多維.txt");

// Render 就緒：健康檢查端點
app.get('/healthz', (req,res)=>{ res.json({ ok:true, uptime: process.uptime() }); });

function ensureMailboxFile(){
  try {
    if (!fs.existsSync(MAILBOX_PATH)) {
      fs.writeFileSync(MAILBOX_PATH, JSON.stringify([]), "utf8");
    }
  } catch (e) { console.error("初始化 mailbox.json 失敗", e); }
}
function loadMailbox(){
  ensureMailboxFile();
  try {
    const raw = fs.readFileSync(MAILBOX_PATH, "utf8");
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (e) { console.error("讀取 mailbox.json 失敗", e); return []; }
}
function saveMailbox(list){
  try { fs.writeFileSync(MAILBOX_PATH, JSON.stringify(list, null, 2), "utf8"); }
  catch(e){ console.error("寫入 mailbox.json 失敗", e); }
}
function readPromptFile(){
  try {
    if (fs.existsSync(PROMPT_PATH)) {
      const raw = fs.readFileSync(PROMPT_PATH, "utf8");
      return String(raw || "").trim();
    }
  } catch(e){ console.error("讀取多維提示詞檔失敗", e); }
  return "請依照主題生成多維度卡片內容，並遵守下方的輸出格式要求。";
}

app.get("/api/topics", (req,res)=>{
  res.json(["工作 / 職場","家庭 / 關係","壓力 / 焦慮","病痛 / 醫治","供應 / 需要","饒恕 / 和好","方向 / 抉擇","信心 / 盼望","平安 / 安息","感恩 / 敬拜"]);
});

// 信箱 API：列出、保存、刪除
app.get("/api/mailbox", (req,res)=>{
  const list = loadMailbox().sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
  res.json({ ok: true, list });
});
app.post("/api/mailbox", (req,res)=>{
  const { topic, text, directions, verses, actions, createdAt } = req.body || {};
  if (!text) return res.status(400).json({ ok:false, error:"缺少文字內容" });
  const list = loadMailbox();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const item = { id, topic, text, directions, verses, actions, createdAt: createdAt || Date.now() };
  list.unshift(item);
  saveMailbox(list.slice(0, 500)); // 最多保留500筆
  res.json({ ok:true, id });
});
app.delete("/api/mailbox/:id", (req,res)=>{
  const id = req.params.id;
  const list = loadMailbox();
  const next = list.filter(x=> x.id !== id);
  saveMailbox(next);
  res.json({ ok:true });
});

app.post("/api/generate", async (req,res) => {
  const { topic = "信心 / 盼望", nickname = "親愛的孩子" } = req.body || {};
  const basePrompt = readPromptFile();
  const enforceJson = `務必只輸出純 JSON 格式，前後不要加上 \`\`\`json 或 \`\`\` 或任意文字。`+
    `務必輸出為 JSON 物件，欄位：`+
    `{"稱呼":"...","完整信件":"一氣呵成的全信文字（含必要段落與收尾）","三方向":"...","兩經文":"經文1: [引用+標註]；經文2: [引用+標註]","兩個行動呼籱":"第一行動：簡短實踐（1-2句）；第二行動：簡短實踐（1-2句）"}`+
    `，不要輸出多餘文字。`;
  const prompt2 = `${basePrompt}\n\n主題：${topic}\n\n${enforceJson}`;
  const prompt = `你是一位慈愛的天父，正在親筆寫一封溫暖的屬靈信件給${nickname}。`+
    `這封信圍繞${topic}的脈絡，語氣全程以溫柔鼓勵貫穿，從開頭到結尾一致。`+
    `信件長度150-250字，像家書般流暢，充滿聖經智慧、安慰與盼望。`+
    `結構（必須連貫寫成一封完整信，不要分段標號）：`+
    `1. 開頭：用稱呼溫柔問安，引入主題（例如，「孩子，願我的平安充滿你心。我看見你在${topic}中的掙扎...」）。`+
    `2. 主要內容：以三個方向為主軸（安慰你的現在、帶來盼望的未來、堅定信心的根基），圍繞${topic}展開屬靈關懷、勸勉與教導。`+
    `自然融入基督教真理，讓讀者感覺被聽見、被愛。隨機選擇兩節適合的聖經經文（新約或舊約皆可，和合本），`+
    `直接引用並標註書名、章節:節數（例如，「如腓立比書4:7所說：神所賜出人意外的平安...」），讓經文如亮光照亮三個方向。`+
    `3. 結尾：溫柔呼籲讀者實踐兩個行動呼籲（每個1-2句，簡述如何做，層次連結如「先...，然後...」），`+
    `鼓勵立即行動，並以「永遠愛你的天父」簽名結束。`+
    `務必只輸出純 JSON 格式，前後不要加上 \`\`\`json 或 \`\`\` 或任意文字。`+
    `務必輸出為 JSON 物件，欄位：`+
    `{"稱呼":"...","完整信件":"一氣呵成的全信文字（含開頭問安、主要內容、三方向、兩經文、兩個行動呼籲與結尾）","三方向":"...","兩經文":"經文1: [引用+標註]；經文2: [引用+標註]","兩個行動呼籱":"第一行動：簡短實踐（1-2句）；第二行動：簡短實踐（1-2句）"}`+
    `，不要輸出多餘文字。`;

  try {
    if (client) {
      const completion = await client.chat.completions.create({
        model: process.env.AI_MODEL || "",
        temperature: 0.7,
        max_tokens: 1200,
        // 要求以 JSON 物件格式輸出（避免出現 ```json 包裝）
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt2 }]
      });
      let content = completion.choices?.[0]?.message?.content || "{}";
      // 若模型仍輸出為 ```json 包裝，移除後再解析
      const fenceMatch = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
      if (fenceMatch) { content = fenceMatch[1]; }
      let data;
      try { data = JSON.parse(content); } catch { data = { letter: content }; }
      res.json({ ok: true, data });
    } else {
      // 本機無金鑰時的示範輸出，便於 UI 預覽
      const demo = {
        "稱呼": nickname,
        "完整信件": `${nickname}，願平安充滿你心。在${topic}的路上，我看見你的掙扎與盼望。今天先安慰你現在的心，記得我與你同在；也把眼目抬起看見未來的亮光；更要堅定信心的根基在我的話語上。正如腓立比書4:7與詩篇23:1提醒你：我必看顧你，使你心思意念得安息。先用三分鐘安靜呼吸、向我傾心；然後寫下兩件感恩的事並與家人分享。永遠愛你的天父。`,
        "三方向": "安慰現在、盼望未來、堅定根基",
        "兩經文": "腓立比書4:7；詩篇23:1",
        "兩個行動呼籲": "禱告：安靜三分鐘向神訴說；感恩：寫下兩件並分享"
      };
      res.json({ ok: true, data: demo, demo: true });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "AI 生成失敗" });
  }
});

app.listen(PORT, () => console.log(`天父的信伺服器啟動於 http://localhost:${PORT}/`));