(function () {
  window.duoHintCount = 0;
  const originalHandleAction = handleAction;
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
    return tokenize(card.en).slice(0, window.duoHintCount);
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
    return `
      <section class="grid two">
        <div class="panel prompt">
          <div class="prompt-ja">${escapeHtml(card.ja)}</div>
          <textarea class="answer-input" id="answer" placeholder="英文を入力" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" inputmode="text" ${result ? "disabled" : ""}>${escapeHtml(result?.input || "")}</textarea>
          <div class="actions">
            <button data-action="check-answer" ${result ? "disabled" : ""}>判定</button>
            <button class="secondary" data-action="show-hint" ${result || window.duoHintCount >= totalHintWords ? "disabled" : ""}>ヒント</button>
            <button class="secondary" data-action="skip-card">次の問題</button>
          </div>
          ${window.duoHintCount ? `
            <div class="hint-box">
              <span>ヒント ${window.duoHintCount}語</span>
              <strong>${hints.map(escapeHtml).join(" ")}</strong>
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
      window.duoHintCount = Math.min(tokenize(currentCard.en).length, window.duoHintCount + 1);
      render();
      return;
    }
    if (action === "check-answer") {
      const input = document.querySelector("#answer").value;
      const graded = gradeAnswer(input, currentCard.en);
      graded.baseRating = graded.suggestedRating;
      if (window.duoHintCount > 0) {
        graded.suggestedRating = hintAdjustedRating(input, currentCard.en, window.duoHintCount);
      }
      graded.hintsUsed = window.duoHintCount;
      answerChecked = { input, ...graded };
      window.duoHintCount = 0;
      render();
      return;
    }
    if (action === "accept-auto-rating") {
      updateSchedule(currentCard.id, answerChecked.suggestedRating, answerChecked.correct);
      currentCard = pickCard();
      answerChecked = null;
      window.duoHintCount = 0;
      render();
      return;
    }
    if (action === "skip-card") {
      currentCard = pickCard();
      answerChecked = null;
      window.duoHintCount = 0;
      render();
      return;
    }
    originalHandleAction(event);
  };

  const style = document.createElement("style");
  style.textContent = `
    .hint-box,
    .hint-note {
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
