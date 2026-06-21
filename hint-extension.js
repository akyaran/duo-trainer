(function () {
  window.duoHintCount = 0;
  window.duoHintIndexes = [];
  window.duoDraftAnswer = "";
  window.duoVoiceStatus = "";
  window.duoVoiceRecognition = null;
  const originalHandleAction = handleAction;
  const originalBindEvents = bindEvents;
  const ratingLabels = {
    again: "Again",
    hard: "Hard",
    good: "Good",
    easy: "Easy"
  };

  function hintAdjustedRating(input, expected, hintsUsed) {
    if (!normalizeAnswer(input)) return "again";
    const inputWords = tokenize(input);
    const expectedWords = tokenize(expected);
    if (!expectedWords.length) return "good";
    const matched = expectedWords.filter((word, index) => inputWords[index] === word).length;
    const adjustedAccuracy = Math.max(0, matched - hintsUsed) / expectedWords.length;
    if (adjustedAccuracy >= 0.9) return "good";
    if (adjustedAccuracy >= 0.75) return "hard";
    return "again";
  }

  function hintWords(card) {
    const expectedWords = tokenize(card.en);
    const displayWords = card.en.trim().split(/\s+/).filter(Boolean);
    return window.duoHintIndexes
      .map((index) => ({ index, word: displayWords[index] || expectedWords[index] }))
      .filter((hint) => hint.word);
  }

  function nextHintIndex(input, expected) {
    const inputWords = tokenize(input);
    const expectedWords = tokenize(expected);
    const used = new Set(window.duoHintIndexes);
    for (let index = 0; index < expectedWords.length; index += 1) {
      if (used.has(index)) continue;
      if (inputWords[index] !== expectedWords[index]) return index;
    }
    return -1;
  }

  function resetStudyState() {
    answerChecked = null;
    window.duoHintCount = 0;
    window.duoHintIndexes = [];
    window.duoDraftAnswer = "";
    window.duoVoiceStatus = "";
  }

  function checkCurrentAnswer() {
    const answer = document.querySelector("#answer");
    const input = answer?.value || "";
    const hintsUsed = window.duoHintIndexes.length;
    const graded = gradeAnswer(input, currentCard.en);
    graded.baseRating = graded.suggestedRating;
    if (hintsUsed > 0) {
      graded.suggestedRating = hintAdjustedRating(input, currentCard.en, hintsUsed);
    }
    graded.hintsUsed = hintsUsed;
    answerChecked = { input, ...graded };
    window.duoHintCount = 0;
    window.duoHintIndexes = [];
    window.duoDraftAnswer = "";
    window.duoVoiceStatus = "";
    render();
  }

  function acceptAutoRating() {
    updateSchedule(currentCard.id, answerChecked.suggestedRating, answerChecked.correct);
    currentCard = pickCard();
    resetStudyState();
    render();
  }

  function bindStudyInput() {
    const answer = document.querySelector("#answer");
    if (answer && !answer.disabled) {
      answer.addEventListener("input", () => {
        window.duoDraftAnswer = answer.value;
      });
      answer.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        checkCurrentAnswer();
      });
    }
    if (answerChecked) {
      document.querySelector("[data-action='accept-auto-rating']")?.focus();
    }
  }

  function startVoiceInput() {
    const answer = document.querySelector("#answer");
    if (!answer || answer.disabled) return;
    answer.focus();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      window.duoVoiceStatus = "この環境ではアプリ内音声入力に未対応です。キーボードのマイクを使ってください。";
      render();
      return;
    }
    if (window.duoVoiceRecognition) {
      window.duoVoiceRecognition.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    window.duoVoiceRecognition = recognition;
    const baseText = answer.value.trim();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      window.duoVoiceStatus = "聞き取り中...";
      const status = document.querySelector("#voice-status");
      if (status) status.textContent = window.duoVoiceStatus;
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      answer.value = [baseText, transcript].filter(Boolean).join(" ");
      window.duoDraftAnswer = answer.value;
    };
    recognition.onerror = () => {
      window.duoVoiceStatus = "音声入力を開始できませんでした。キーボードのマイクも使えます。";
    };
    recognition.onend = () => {
      window.duoVoiceRecognition = null;
      const status = document.querySelector("#voice-status");
      if (status) status.textContent = window.duoVoiceStatus || "";
    };
    recognition.start();
  }

  renderStudy = function (s) {
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
    const hints = hintWords(card);
    const totalHintWords = tokenize(card.en).length;
    const answerValue = result?.input || window.duoDraftAnswer || "";
    return `
      <section class="grid two">
        <div class="panel prompt">
          <div class="prompt-ja">${escapeHtml(card.ja)}</div>
          <textarea class="answer-input" id="answer" placeholder="英文を入力" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text" ${result ? "disabled" : ""}>${escapeHtml(answerValue)}</textarea>
          <div class="actions">
            <button data-action="check-answer" ${result ? "disabled" : ""}>判定</button>
            <button class="secondary" data-action="voice-input" ${result ? "disabled" : ""}>音声入力</button>
            <button class="secondary" data-action="show-hint" ${result || window.duoHintIndexes.length >= totalHintWords ? "disabled" : ""}>ヒント</button>
            <button class="secondary" data-action="skip-card">次の問題</button>
          </div>
          ${window.duoVoiceStatus ? `<div class="voice-status" id="voice-status">${escapeHtml(window.duoVoiceStatus)}</div>` : ""}
          ${window.duoHintIndexes.length ? `
            <div class="hint-box">
              <span>ヒント ${window.duoHintIndexes.length}回</span>
              <strong>${hints.map((hint) => `${hint.index + 1}語目: ${escapeHtml(hint.word)}`).join(" / ")}</strong>
            </div>
          ` : ""}
          ${result ? renderResult(card, result) : ""}
        </div>
        <aside class="panel">
          <h2>今日の状態</h2>
          <div class="stats">
            <div class="stat"><span>登録</span><strong>${s.total}</strong></div>
            <div class="stat"><span>復習待ち</span><strong>${s.due}</strong></div>
            <div class="stat"><span>本日学習</span><strong>${s.todayReviewed}</strong></div>
            <div class="stat"><span>学習済み</span><strong>${s.learned}</strong></div>
            <div class="stat"><span>正答率</span><strong>${s.accuracy}%</strong></div>
          </div>
        </aside>
      </section>
    `;
  };

  renderResult = function (card, result) {
    const diff = diffWords(result.input, card.en);
    return `
      <div class="result ${result.correct ? "ok" : "bad"}">
        <strong>${result.correct ? "正解です" : "もう一歩です"}</strong>
        <div class="auto-rating">自動判定: <strong>${ratingLabels[result.suggestedRating]}</strong></div>
        ${result.hintsUsed ? `<div class="hint-note">ヒント使用: ${result.hintsUsed}回</div>` : ""}
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
  };

  handleAction = function (event) {
    const action = event.currentTarget.dataset.action;
    if (action === "show-hint") {
      const input = document.querySelector("#answer")?.value || "";
      window.duoDraftAnswer = input;
      const index = nextHintIndex(input, currentCard.en);
      if (index >= 0) {
        window.duoHintIndexes.push(index);
        window.duoHintCount = window.duoHintIndexes.length;
      }
      render();
      return;
    }
    if (action === "check-answer") {
      checkCurrentAnswer();
      return;
    }
    if (action === "voice-input") {
      startVoiceInput();
      return;
    }
    if (action === "accept-auto-rating") {
      acceptAutoRating();
      return;
    }
    if (action === "skip-card") {
      currentCard = pickCard();
      resetStudyState();
      render();
      return;
    }
    originalHandleAction(event);
  };

  bindEvents = function () {
    originalBindEvents();
    document.querySelectorAll("[data-tab], [data-rating]").forEach((button) => {
      button.addEventListener("click", resetStudyState, { capture: true });
    });
    bindStudyInput();
  };

  const style = document.createElement("style");
  style.textContent = `
    .hint-box,
    .hint-note,
    .voice-status {
      display: grid;
      gap: 4px;
      border: 1px solid #d7caa9;
      border-radius: 8px;
      background: #fff8e9;
      color: #5c4217;
      padding: 10px 12px;
    }

    .hint-box span,
    .hint-note {
      font-size: 0.9rem;
    }

    .hint-box strong {
      color: var(--ink);
      line-height: 1.5;
    }
  `;
  document.head.appendChild(style);

  render();
})();
