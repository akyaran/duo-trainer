const STORAGE_KEY = "duo-trainer-state-v1";
const VERSION = 1;

const state = loadState();
let activeTab = "study";
let currentCard = null;
let answerChecked = null;
let editingId = null;

const app = document.querySelector("#app");

const tabs = [
  ["study", "学習"],
  ["library", "例文管理"],
  ["import", "インポート"],
  ["progress", "進捗"]
];

function defaultState() {
  return {
    version: VERSION,
    cards: [],
    reviews: {},
    sessions: [],
    settings: {
      newCardsPerDay: 20
    }
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultState();
    return { ...defaultState(), ...JSON.parse(saved) };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeAnswer(value) {
  return value
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[.,!?;:()[\]{}"。、！？；：]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function gradeAnswer(input, expected) {
  const inputNorm = normalizeAnswer(input);
  const expectedNorm = normalizeAnswer(expected);
  const suggestedRating = suggestRating(input, expected, inputNorm, expectedNorm);
  return {
    correct: inputNorm === expectedNorm,
    inputNorm,
    expectedNorm,
    suggestedRating
  };
}

function tokenize(value) {
  return normalizeAnswer(value).split(" ").filter(Boolean);
}

function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }
  return rows[a.length][b.length];
}

function similarity(inputNorm, expectedNorm) {
  const longest = Math.max(inputNorm.length, expectedNorm.length);
  if (!longest) return 1;
  return 1 - editDistance(inputNorm, expectedNorm) / longest;
}

function wordAccuracy(input, expected) {
  const inputWords = tokenize(input);
  const expectedWords = tokenize(expected);
  if (!expectedWords.length) return 1;
  const matched = expectedWords.filter((word, index) => inputWords[index] === word).length;
  return matched / expectedWords.length;
}

function suggestRating(input, expected, inputNorm, expectedNorm) {
  const inputTrimmed = input.trim();
  const expectedTrimmed = expected.trim();
  if (!inputNorm) return "again";
  if (inputTrimmed === expectedTrimmed) return "easy";
  if (inputNorm === expectedNorm) return "good";

  const closeByText = similarity(inputNorm, expectedNorm);
  const closeByWords = wordAccuracy(input, expected);
  if (closeByText >= 0.86 || closeByWords >= 0.78) return "hard";
  return "again";
}

function diffWords(input, expected) {
  const inputWords = tokenize(input);
  const expectedWords = tokenize(expected);
  return expectedWords.map((word, index) => ({
    word,
    ok: inputWords[index] === word
  }));
}

function reviewFor(cardId) {
  if (!state.reviews[cardId]) {
    state.reviews[cardId] = {
      repetitions: 0,
      intervalDays: 0,
      easeFactor: 2.5,
      dueAt: new Date().toISOString(),
      lastResult: null,
      lapses: 0,
      totalAnswers: 0,
      correctAnswers: 0
    };
  }
  return state.reviews[cardId];
}

function dueCards() {
  const now = Date.now();
  return state.cards.filter((card) => new Date(reviewFor(card.id).dueAt).getTime() <= now);
}

function pickCard() {
  const due = dueCards();
  const pool = due.length ? due : state.cards;
  if (!pool.length) return null;
  const weighted = pool.flatMap((card) => {
    const review = reviewFor(card.id);
    const weight = review.lastResult === "again" ? 4 : review.lapses > 0 ? 2 : 1;
    return Array.from({ length: weight }, () => card);
  });
  return weighted[Math.floor(Math.random() * weighted.length)];
}

function updateSchedule(cardId, rating, wasCorrect) {
  const review = reviewFor(cardId);
  const quality = { again: 1, hard: 3, good: 4, easy: 5 }[rating];
  review.totalAnswers += 1;
  if (wasCorrect) review.correctAnswers += 1;

  if (quality < 3) {
    review.repetitions = 0;
    review.intervalDays = 0;
    review.easeFactor = Math.max(1.3, review.easeFactor - 0.2);
    review.dueAt = addDays(new Date(), 0).toISOString();
    review.lapses += 1;
  } else {
    review.easeFactor = Math.max(
      1.3,
      review.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
    review.repetitions += 1;

    if (review.repetitions === 1) review.intervalDays = rating === "easy" ? 2 : 1;
    else if (review.repetitions === 2) review.intervalDays = rating === "hard" ? 3 : 6;
    else review.intervalDays = Math.round(review.intervalDays * review.easeFactor);

    if (rating === "hard") review.intervalDays = Math.max(1, Math.round(review.intervalDays * 0.6));
    if (rating === "easy") review.intervalDays = Math.round(review.intervalDays * 1.35);
    review.dueAt = addDays(todayStart(), review.intervalDays).toISOString();
  }

  review.lastResult = rating;
  review.lastReviewedAt = new Date().toISOString();
  state.sessions.push({
    id: uid(),
    cardId,
    rating,
    wasCorrect,
    at: new Date().toISOString()
  });
  saveState();
}

function parseDelimited(text) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = (cells[index] || "").trim();
    });
    return item;
  });
}

function importRows(rows) {
  let added = 0;
  const now = new Date().toISOString();
  rows.forEach((row) => {
    if (!row.ja || !row.en) return;
    const card = {
      id: uid(),
      ja: row.ja,
      en: row.en,
      section: row.section || "",
      tags: (row.tags || "").split(/[|,]/).map((tag) => tag.trim()).filter(Boolean),
      createdAt: now,
      updatedAt: now
    };
    state.cards.push(card);
    reviewFor(card.id);
    added += 1;
  });
  saveState();
  return added;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stats() {
  const total = state.cards.length;
  const due = dueCards().length;
  const reviewed = state.sessions.length;
  const correct = state.sessions.filter((session) => session.wasCorrect).length;
  const accuracy = reviewed ? Math.round((correct / reviewed) * 100) : 0;
  const learned = Object.values(state.reviews).filter((review) => review.repetitions > 0).length;
  return { total, due, reviewed, correct, accuracy, learned };
}

function render() {
  const s = stats();
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">D</div>
          <div>
            <h1>Duo Trainer</h1>
            <p>日本語から英文を思い出す間隔反復トレーニング</p>
          </div>
        </div>
        <button class="secondary" data-action="export-json">書き出し</button>
      </header>
      ${renderActiveTab(s)}
      <nav class="tabs" aria-label="メイン">
        ${tabs.map(([id, label]) => `
          <button class="tab ${activeTab === id ? "active" : ""}" data-tab="${id}">${label}</button>
        `).join("")}
      </nav>
    </main>
  `;
  bindEvents();
}

function renderActiveTab(s) {
  if (activeTab === "study") return renderStudy(s);
  if (activeTab === "library") return renderLibrary();
  if (activeTab === "import") return renderImport();
  return renderProgress(s);
}

function renderStudy(s) {
  if (!state.cards.length) {
    return `
      <section class="panel empty">
        <div>
          <h2>例文を追加すると学習を開始できます</h2>
          <p>CSV/TSVインポートか、例文管理から追加してください。</p>
        </div>
      </section>
    `;
  }

  if (!currentCard) currentCard = pickCard();
  const card = currentCard;
  const result = answerChecked;
  return `
    <section class="grid two">
      <div class="panel prompt">
        <div class="prompt-ja">${escapeHtml(card.ja)}</div>
        <textarea class="answer-input" id="answer" placeholder="英文を入力" ${result ? "disabled" : ""}>${escapeHtml(result?.input || "")}</textarea>
        <div class="actions">
          <button data-action="check-answer" ${result ? "disabled" : ""}>判定</button>
          <button class="secondary" data-action="skip-card">次の問題</button>
        </div>
        ${result ? renderResult(card, result) : ""}
      </div>
      <aside class="panel">
        <h2>今日の状態</h2>
        <div class="stats">
          <div class="stat"><span>登録</span><strong>${s.total}</strong></div>
          <div class="stat"><span>復習待ち</span><strong>${s.due}</strong></div>
          <div class="stat"><span>学習済み</span><strong>${s.learned}</strong></div>
          <div class="stat"><span>正答率</span><strong>${s.accuracy}%</strong></div>
        </div>
      </aside>
    </section>
  `;
}

function renderResult(card, result) {
  const diff = diffWords(result.input, card.en);
  const ratingLabels = {
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy"
  };
  return `
    <div class="result ${result.correct ? "ok" : "bad"}">
      <strong>${result.correct ? "正解です" : "もう一歩です"}</strong>
      <div class="auto-rating">自動判定: <strong>${ratingLabels[result.suggestedRating]}</strong></div>
      <div class="correct-answer">${escapeHtml(card.en)}</div>
      <div class="diff">
        ${diff.map((part) => `<span class="${part.ok ? "" : "miss"}">${escapeHtml(part.word)}</span>`).join("")}
      </div>
      <div class="actions">
        <button data-action="accept-auto-rating">この判定で次へ</button>
      </div>
      <div class="score-buttons">
        <button class="${result.suggestedRating === "again" ? "" : "secondary"}" data-rating="again">Again</button>
        <button class="${result.suggestedRating === "hard" ? "" : "secondary"}" data-rating="hard">Hard</button>
        <button class="${result.suggestedRating === "good" ? "" : "secondary"}" data-rating="good">Good</button>
        <button class="${result.suggestedRating === "easy" ? "" : "secondary"}" data-rating="easy">Easy</button>
      </div>
    </div>
  `;
}

function renderLibrary() {
  const query = (document.querySelector("#search")?.value || "").toLowerCase();
  const cards = state.cards.filter((card) =>
    [card.ja, card.en, card.section, card.tags.join(" ")].join(" ").toLowerCase().includes(query)
  );
  const editing = state.cards.find((card) => card.id === editingId);
  return `
    <section class="grid two">
      <form class="panel form-grid" data-form="card">
        <h2 class="wide">${editing ? "例文を編集" : "例文を追加"}</h2>
        <label class="wide">日本語
          <textarea name="ja" required>${escapeHtml(editing?.ja || "")}</textarea>
        </label>
        <label class="wide">英文
          <textarea name="en" required>${escapeHtml(editing?.en || "")}</textarea>
        </label>
        <label>セクション
          <input name="section" value="${escapeHtml(editing?.section || "")}" />
        </label>
        <label>タグ
          <input name="tags" placeholder="重要, 比較" value="${escapeHtml(editing?.tags?.join(", ") || "")}" />
        </label>
        <div class="actions wide">
          <button type="submit">${editing ? "更新" : "追加"}</button>
          ${editing ? `<button class="secondary" type="button" data-action="cancel-edit">キャンセル</button>` : ""}
        </div>
      </form>
      <div class="panel">
        <h2>登録例文</h2>
        <input id="search" placeholder="検索" value="${escapeHtml(query)}" />
        <div class="list">
          ${cards.length ? cards.map(renderCardItem).join("") : `<div class="empty">該当する例文がありません</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderCardItem(card) {
  const review = reviewFor(card.id);
  const due = new Date(review.dueAt).toLocaleDateString("ja-JP");
  return `
    <article class="example-item">
      <header>
        <div class="badge-row">
          ${card.section ? `<span class="badge">${escapeHtml(card.section)}</span>` : ""}
          ${card.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
          <span class="badge">次回 ${due}</span>
        </div>
        <div class="actions">
          <button class="secondary icon" title="編集" data-edit="${card.id}">✎</button>
          <button class="danger icon" title="削除" data-delete="${card.id}">×</button>
        </div>
      </header>
      <p><strong>日:</strong> ${escapeHtml(card.ja)}</p>
      <p><strong>英:</strong> ${escapeHtml(card.en)}</p>
    </article>
  `;
}

function renderImport() {
  return `
    <section class="grid two">
      <div class="panel import-box">
        <h2>CSV/TSVインポート</h2>
        <div class="notice">DUO 3.0本文は同梱していません。ご自身で用意した学習用データを取り込んでください。</div>
        <textarea id="csv-input" placeholder="ここにCSVまたはTSVを貼り付け"></textarea>
        <div class="actions">
          <button data-action="import-csv">取り込む</button>
          <button class="secondary" data-action="load-sample">サンプルを入れる</button>
        </div>
        <h3>形式</h3>
        <pre class="sample">ja,en,section,tags
私は毎朝英語を音読します。,I read English aloud every morning.,Section 1,習慣|基礎
彼女は約束を守った。,She kept her promise.,Section 1,重要</pre>
      </div>
      <div class="panel import-box">
        <h2>バックアップ</h2>
        <p class="muted">端末内のデータをJSONで書き出し、別の端末で読み込めます。</p>
        <input type="file" id="json-file" accept="application/json" />
        <div class="actions">
          <button class="secondary" data-action="import-json">JSONを読み込む</button>
          <button class="secondary" data-action="export-json">JSONを書き出す</button>
        </div>
      </div>
    </section>
  `;
}

function renderProgress(s) {
  const recent = state.sessions.slice(-20).reverse();
  return `
    <section class="grid two">
      <div class="panel">
        <h2>進捗</h2>
        <div class="stats">
          <div class="stat"><span>登録例文</span><strong>${s.total}</strong></div>
          <div class="stat"><span>復習待ち</span><strong>${s.due}</strong></div>
          <div class="stat"><span>回答数</span><strong>${s.reviewed}</strong></div>
          <div class="stat"><span>正答率</span><strong>${s.accuracy}%</strong></div>
        </div>
      </div>
      <div class="panel">
        <h2>最近の学習</h2>
        <div class="list">
          ${recent.length ? recent.map((session) => {
            const card = state.cards.find((item) => item.id === session.cardId);
            return `
              <div class="example-item">
                <p><strong>${escapeHtml(session.rating)}</strong> ${session.wasCorrect ? "正解" : "不正解"} · ${new Date(session.at).toLocaleString("ja-JP")}</p>
                <p>${escapeHtml(card?.ja || "削除済みの例文")}</p>
              </div>
            `;
          }).join("") : `<div class="empty">まだ学習履歴がありません</div>`}
        </div>
      </div>
    </section>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      answerChecked = null;
      currentCard = null;
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleAction);
  });

  document.querySelectorAll("[data-rating]").forEach((button) => {
    button.addEventListener("click", () => {
      updateSchedule(currentCard.id, button.dataset.rating, answerChecked.correct);
      currentCard = pickCard();
      answerChecked = null;
      render();
    });
  });

  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      editingId = button.dataset.edit;
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!confirm("この例文を削除しますか？")) return;
      state.cards = state.cards.filter((card) => card.id !== button.dataset.delete);
      delete state.reviews[button.dataset.delete];
      saveState();
      currentCard = null;
      render();
    });
  });

  document.querySelector("[data-form='card']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const now = new Date().toISOString();
    const values = {
      ja: form.get("ja").trim(),
      en: form.get("en").trim(),
      section: form.get("section").trim(),
      tags: form.get("tags").split(",").map((tag) => tag.trim()).filter(Boolean)
    };
    if (!values.ja || !values.en) return;
    if (editingId) {
      const card = state.cards.find((item) => item.id === editingId);
      Object.assign(card, values, { updatedAt: now });
      editingId = null;
    } else {
      const card = { id: uid(), ...values, createdAt: now, updatedAt: now };
      state.cards.push(card);
      reviewFor(card.id);
    }
    saveState();
    render();
  });

  document.querySelector("#search")?.addEventListener("input", () => render());
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "check-answer") {
    const input = document.querySelector("#answer").value;
    answerChecked = { input, ...gradeAnswer(input, currentCard.en) };
    render();
  }
  if (action === "accept-auto-rating") {
    updateSchedule(currentCard.id, answerChecked.suggestedRating, answerChecked.correct);
    currentCard = pickCard();
    answerChecked = null;
    render();
  }
  if (action === "skip-card") {
    currentCard = pickCard();
    answerChecked = null;
    render();
  }
  if (action === "cancel-edit") {
    editingId = null;
    render();
  }
  if (action === "load-sample") {
    document.querySelector("#csv-input").value = "ja,en,section,tags\n私は毎朝英語を音読します。,I read English aloud every morning.,Section 1,習慣|基礎\n彼女は約束を守った。,She kept her promise.,Section 1,重要";
  }
  if (action === "import-csv") {
    const rows = parseDelimited(document.querySelector("#csv-input").value);
    const added = importRows(rows);
    alert(`${added}件を取り込みました。`);
    activeTab = "library";
    render();
  }
  if (action === "export-json") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `duo-trainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (action === "import-json") {
    const file = document.querySelector("#json-file")?.files?.[0];
    if (!file) {
      alert("JSONファイルを選択してください。");
      return;
    }
    file.text().then((text) => {
      const imported = JSON.parse(text);
      Object.assign(state, defaultState(), imported);
      saveState();
      currentCard = null;
      answerChecked = null;
      alert("JSONを読み込みました。");
      render();
    }).catch(() => alert("JSONを読み込めませんでした。"));
  }
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

render();
