import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createWorker } from "tesseract.js";
import "./styles.css";

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const initialTransactions = [];
const initialCards = [];
const initialProfile = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadState(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [profile, setProfile] = useState(() => loadState("baito-money-profile", initialProfile));
  const [isUnlocked, setIsUnlocked] = useState(() => !loadState("baito-money-profile", initialProfile));
  const [loginPasscode, setLoginPasscode] = useState("");
  const [authError, setAuthError] = useState("");
  const [setupForm, setSetupForm] = useState({
    name: "",
    passcode: "",
    bankName: "UFJ",
    bankBalance: "",
    payday: "25",
    monthlyIncome: "",
    monthlyBudget: "",
    mainCard: "楽天カード",
    cardDueDay: "27",
  });
  const [transactions, setTransactions] = useState(() =>
    loadState("baito-money-transactions", initialTransactions)
  );
  const [cards, setCards] = useState(() => loadState("baito-money-cards", initialCards));
  const [bankBalance, setBankBalance] = useState(() => loadState("baito-money-bank-balance", 0));
  const [quickText, setQuickText] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiRows, setAiRows] = useState([]);
  const [aiStatus, setAiStatus] = useState("");
  const [aiError, setAiError] = useState("");
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [transactionForm, setTransactionForm] = useState({
    type: "income",
    title: "",
    amount: "",
    date: today(),
  });
  const [cardForm, setCardForm] = useState({
    name: "",
    amount: "",
    closingDay: "",
    dueDate: today(),
    memo: "",
  });

  useEffect(() => {
    localStorage.setItem("baito-money-transactions", JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem("baito-money-cards", JSON.stringify(cards));
  }, [cards]);

  useEffect(() => {
    localStorage.setItem("baito-money-bank-balance", JSON.stringify(bankBalance));
  }, [bankBalance]);

  useEffect(() => {
    if (profile) {
      localStorage.setItem("baito-money-profile", JSON.stringify(profile));
    }
  }, [profile]);

  const totals = useMemo(() => {
    const income = transactions
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const expense = transactions
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const cardTotal = cards.reduce((sum, card) => sum + Number(card.amount), 0);
    const beforeCard = income - expense;

    return {
      income,
      expense,
      cardTotal,
      beforeCard,
      afterCard: beforeCard - cardTotal,
      bankAfterCard: Number(bankBalance) - cardTotal,
    };
  }, [transactions, cards, bankBalance]);

  const cardPlans = useMemo(() => {
    let runningBalance = Number(bankBalance);

    return [...cards]
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      .map((card) => {
        runningBalance -= Number(card.amount);

        return {
          ...card,
          daysLeft: daysUntil(card.dueDate),
          balanceAfter: runningBalance,
        };
      });
  }, [cards, bankBalance]);

  function addTransaction(event) {
    event.preventDefault();
    const amount = Number(transactionForm.amount);
    if (!transactionForm.title.trim() || !amount) return;

    setTransactions((items) => [
      {
        id: crypto.randomUUID(),
        type: transactionForm.type,
        title: transactionForm.title.trim(),
        amount,
        date: transactionForm.date,
      },
      ...items,
    ]);
    setTransactionForm((form) => ({ ...form, title: "", amount: "" }));
  }

  function addCard(event) {
    event.preventDefault();
    const amount = Number(cardForm.amount);
    if (!cardForm.name.trim() || !amount) return;

    setCards((items) => [
      {
        id: crypto.randomUUID(),
        name: cardForm.name.trim(),
        amount,
        closingDay: cardForm.closingDay,
        dueDate: cardForm.dueDate,
        memo: cardForm.memo.trim(),
      },
      ...items,
    ]);
    setCardForm((form) => ({ ...form, name: "", amount: "", memo: "" }));
  }

  function removeTransaction(id) {
    setTransactions((items) => items.filter((item) => item.id !== id));
  }

  function removeCard(id) {
    setCards((items) => items.filter((item) => item.id !== id));
  }

  function registerQuickText(event) {
    event.preventDefault();
    const parsed = parseQuickText(quickText);
    if (!parsed) return;

    if (parsed.kind === "bank") {
      setBankBalance(parsed.amount);
    }

    if (parsed.kind === "card") {
      setCards((items) => [
        {
          id: crypto.randomUUID(),
          name: parsed.title,
          amount: parsed.amount,
          dueDate: parsed.date,
        },
        ...items,
      ]);
    }

    if (parsed.kind === "income" || parsed.kind === "expense") {
      setTransactions((items) => [
        {
          id: crypto.randomUUID(),
          type: parsed.kind,
          title: parsed.title,
          amount: parsed.amount,
          date: parsed.date,
        },
        ...items,
      ]);
    }

    setQuickText("");
  }

  async function analyzeImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setAiError("");
    setAiText("");
    setAiRows([]);
    setAiStatus("画像から文字を抽出中...");

    try {
      const dataUrl = await fileToDataUrl(file);
      setImagePreview(dataUrl);
      const rawText = await extractTextFromImage(dataUrl, setAiStatus);
      setAiText(rawText);
      setAiStatus("文字を抽出しました。AIで整理中...");

      try {
        const organizedText = await organizeTextWithAi(rawText);
        const rows = parseAiTextRows(organizedText);
        setAiText(organizedText);
        setAiRows(rows);
        setAiStatus(`AIで整理しました。${rows.length}件を明細化できます`);
      } catch (organizeError) {
        const rows = parseAiTextRows(rawText);
        setAiRows(rows);
        setAiError(organizeError.message || "AI整理に失敗しました。");
        setAiStatus(`文字だけ抽出しました。${rows.length}件を明細化できます`);
      }
      event.target.value = "";
    } catch (error) {
      setAiError(error.message || "画像から文字を抽出・整理できませんでした。");
      setAiStatus("");
      event.target.value = "";
    }
  }

  async function organizeCurrentText() {
    if (!aiText.trim()) return;

    setIsOrganizing(true);
    setAiError("");
    setAiStatus("AIでテキストを整理中...");

    try {
      const organizedText = await organizeTextWithAi(aiText);
      const rows = parseAiTextRows(organizedText);
      setAiText(organizedText);
      setAiRows(rows);
      setAiStatus(`AIで整理しました。${rows.length}件を明細化できます`);
    } catch (error) {
      setAiError(error.message || "AIで整理できませんでした。");
      setAiStatus("");
    } finally {
      setIsOrganizing(false);
    }
  }

  function convertAiText() {
    const rows = parseAiTextRows(aiText);
    setAiRows(rows);
    setAiError("");
    setAiStatus(`${rows.length}件を明細化しました`);
  }

  function registerAiRows() {
    if (aiRows.length === 0) return;

    const nextTransactions = [];
    const nextCards = [];

    aiRows.forEach((row) => {
      const amount = Math.abs(Number(row.amount));
      if (!amount) return;

      if (row.kind === "card") {
        nextCards.push({
          id: crypto.randomUUID(),
          name: row.title || "カード引き落とし",
          amount,
          closingDay: "",
          dueDate: row.date || today(),
          memo: "画像読み取りから登録",
        });
        return;
      }

      nextTransactions.push({
        id: crypto.randomUUID(),
        type: row.kind === "income" ? "income" : "expense",
        title: row.title || (row.kind === "income" ? "入金" : "出金"),
        amount,
        date: row.date || today(),
      });
    });

    if (nextTransactions.length > 0) {
      setTransactions((items) => [...nextTransactions, ...items]);
    }

    if (nextCards.length > 0) {
      setCards((items) => [...nextCards, ...items]);
    }

    setAiRows([]);
    setAiStatus("登録しました");
  }

  function updateAiRow(id, key, value) {
    setAiRows((rows) =>
      rows.map((row) =>
        row.id === id
          ? {
              ...row,
              [key]: key === "amount" ? Number(value) : value,
            }
          : row
      )
    );
  }

  function removeAiRow(id) {
    setAiRows((rows) => rows.filter((row) => row.id !== id));
  }

  function finishSetup(event) {
    event.preventDefault();
    if (!setupForm.name.trim() || setupForm.passcode.length < 4) {
      setAuthError("名前と4桁以上の暗証番号を入れてください。");
      return;
    }

    const nextProfile = {
      name: setupForm.name.trim(),
      passcode: setupForm.passcode,
      bankName: setupForm.bankName.trim() || "銀行",
      payday: Number(setupForm.payday) || 25,
      monthlyIncome: Number(setupForm.monthlyIncome) || 0,
      monthlyBudget: Number(setupForm.monthlyBudget) || 0,
      mainCard: setupForm.mainCard.trim() || "カード",
      cardDueDay: Number(setupForm.cardDueDay) || 27,
    };

    setProfile(nextProfile);
    setBankBalance(Number(setupForm.bankBalance) || 0);
    setTransactions([]);
    setCards([]);
    setIsUnlocked(true);
    setAuthError("");
  }

  function login(event) {
    event.preventDefault();
    if (loginPasscode === profile?.passcode) {
      setIsUnlocked(true);
      setLoginPasscode("");
      setAuthError("");
      return;
    }

    setAuthError("暗証番号が違います。");
  }

  function logout() {
    setIsUnlocked(false);
    setAiError("");
    setAiStatus("");
  }

  if (!profile) {
    return (
      <SetupScreen
        setupForm={setupForm}
        setSetupForm={setSetupForm}
        authError={authError}
        onSubmit={finishSetup}
      />
    );
  }

  if (!isUnlocked) {
    return (
      <LoginScreen
        profile={profile}
        passcode={loginPasscode}
        setPasscode={setLoginPasscode}
        authError={authError}
        onSubmit={login}
      />
    );
  }

  return (
    <main className="app">
      <section className="scan-hero">
        <div className="hero-copy">
          <div className="top-bar">
            <p className="eyebrow">scan & save</p>
            <button className="small-button" type="button" onClick={logout}>
              ログアウト
            </button>
          </div>
          <h1>money</h1>
          <p className="hero-lead">
            {profile.name}さんの明細画像から文字を抜き出して、テキストで直してから登録できます。
          </p>
          <div className="hero-metrics">
            <div>
              <span>{profile.bankName} 残高</span>
              <strong>{yen.format(Number(bankBalance))}</strong>
            </div>
            <div>
              <span>引き落とし後</span>
              <strong>{yen.format(totals.bankAfterCard)}</strong>
            </div>
            <div>
              <span>予定収入</span>
              <strong>{yen.format(profile.monthlyIncome)}</strong>
            </div>
            <div>
              <span>月予算</span>
              <strong>{yen.format(profile.monthlyBudget)}</strong>
            </div>
          </div>
        </div>

        <div className="scan-card">
          <div className="panel-heading">
            <h2>画像読み取り</h2>
            <span>キー不要AI</span>
          </div>
          <label className="upload-zone">
            <input
              data-testid="image-input"
              type="file"
              accept="image/*"
              onChange={analyzeImage}
            />
            <span>明細スクショを選ぶ</span>
            <strong>{profile.bankName} / EPOS / {profile.mainCard}</strong>
          </label>
          {imagePreview && (
            <img className="image-preview" src={imagePreview} alt="読み取る明細スクショ" />
          )}
          {aiStatus && <p className="status-text">{aiStatus}</p>}
          {aiError && <p className="error-text">{aiError}</p>}
        </div>
      </section>

      <section className="review-grid">
        <div className="panel ai-text-editor">
          <div className="panel-heading">
            <h2>読み取ったテキスト</h2>
            <button className="primary-button" type="button" onClick={convertAiText}>
              明細に変換
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={organizeCurrentText}
              disabled={isOrganizing || !aiText.trim()}
            >
              AIで整える
            </button>
          </div>
          <textarea
            data-testid="ai-text"
            value={aiText}
            onChange={(event) => setAiText(event.target.value)}
            placeholder={"画像から抽出された文字がここに入ります。\nうまく区切れない時は下の形に直してください。\n2026-09-03 | カード | カード | 120000\n2026-08-30 | 支出 | STARBUCK | 1000\n2026-08-25 | 収入 | 給料 | 14901"}
          />
        </div>

        <div className="panel ai-result">
          {aiRows.length > 0 ? (
            <>
            <div className="panel-heading">
              <h2>登録候補</h2>
              <button className="primary-button" type="button" onClick={registerAiRows}>
                確認して登録
              </button>
            </div>
            <div className="ai-table">
              {aiRows.map((row) => (
                <article className="ai-row" key={row.id}>
                  <input
                    type="date"
                    value={row.date}
                    onChange={(event) => updateAiRow(row.id, "date", event.target.value)}
                  />
                  <input
                    value={row.title}
                    onChange={(event) => updateAiRow(row.id, "title", event.target.value)}
                  />
                  <select
                    value={row.kind}
                    onChange={(event) => updateAiRow(row.id, "kind", event.target.value)}
                  >
                    <option value="income">収入</option>
                    <option value="expense">支出</option>
                    <option value="card">カード</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    value={row.amount}
                    onChange={(event) => updateAiRow(row.id, "amount", event.target.value)}
                  />
                  <button type="button" onClick={() => removeAiRow(row.id)} title="削除">
                    x
                  </button>
                </article>
              ))}
            </div>
            </>
          ) : (
            <div className="empty-state">
              <span>候補なし</span>
              <strong>画像を読むか、テキストを入れて明細化</strong>
            </div>
          )}
        </div>
      </section>

      <section className="summary-grid" aria-label="合計">
        <Summary title="銀行残高" value={Number(bankBalance)} tone="navy" />
        <Summary title="バイト収入" value={totals.income} tone="green" />
        <Summary title="支出" value={totals.expense} tone="red" />
        <Summary title="カード引き落とし" value={totals.cardTotal} tone="amber" />
        <Summary title="入出金ベースの残額" value={totals.afterCard} tone="blue" />
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="panel-heading">
            <h2>テキストで登録</h2>
            <span>銀行・カード・入出金</span>
          </div>
          <form className="quick-form" onSubmit={registerQuickText}>
            <textarea
              data-testid="quick-text"
              value={quickText}
              onChange={(event) => setQuickText(event.target.value)}
              placeholder={"銀行残高 52340\nカード 楽天 12800 9/27\n収入 カフェ 42000\n支出 交通費 5200"}
            />
            <button className="primary-button" type="submit">
              読み取って登録
            </button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>入出金</h2>
            <span>{transactions.length}件</span>
          </div>

          <form className="entry-form" onSubmit={addTransaction}>
            <div className="segmented" aria-label="種別">
              <button
                type="button"
                className={transactionForm.type === "income" ? "active" : ""}
                onClick={() => setTransactionForm((form) => ({ ...form, type: "income" }))}
              >
                収入
              </button>
              <button
                type="button"
                className={transactionForm.type === "expense" ? "active" : ""}
                onClick={() => setTransactionForm((form) => ({ ...form, type: "expense" }))}
              >
                支出
              </button>
            </div>
            <label>
              内容
              <input
                data-testid="transaction-title"
                value={transactionForm.title}
                onChange={(event) =>
                  setTransactionForm((form) => ({ ...form, title: event.target.value }))
                }
                placeholder="例: 居酒屋シフト"
              />
            </label>
            <label>
              金額
              <input
                data-testid="transaction-amount"
                type="number"
                min="0"
                inputMode="numeric"
                value={transactionForm.amount}
                onChange={(event) =>
                  setTransactionForm((form) => ({ ...form, amount: event.target.value }))
                }
                placeholder="0"
              />
            </label>
            <label>
              日付
              <input
                type="date"
                value={transactionForm.date}
                onChange={(event) =>
                  setTransactionForm((form) => ({ ...form, date: event.target.value }))
                }
              />
            </label>
            <button className="primary-button" type="submit">
              追加
            </button>
          </form>

          <div className="list">
            {transactions.map((item) => (
              <Row
                key={item.id}
                title={item.title}
                date={item.date}
                amount={item.amount}
                type={item.type}
                onRemove={() => removeTransaction(item.id)}
              />
            ))}
          </div>
        </div>

        <div className="panel card-panel">
          <div className="panel-heading">
            <h2>カード引き落とし</h2>
            <span>{cards.length}件</span>
          </div>

          <form className="entry-form card-form" onSubmit={addCard}>
            <label>
              カード名
              <input
                data-testid="card-name"
                value={cardForm.name}
                onChange={(event) =>
                  setCardForm((form) => ({ ...form, name: event.target.value }))
                }
                placeholder="例: Visa"
              />
            </label>
            <label>
              締め日
              <input
                type="number"
                min="1"
                max="31"
                inputMode="numeric"
                value={cardForm.closingDay}
                onChange={(event) =>
                  setCardForm((form) => ({ ...form, closingDay: event.target.value }))
                }
                placeholder="例: 末日"
              />
            </label>
            <label>
              引き落とし額
              <input
                data-testid="card-amount"
                type="number"
                min="0"
                inputMode="numeric"
                value={cardForm.amount}
                onChange={(event) =>
                  setCardForm((form) => ({ ...form, amount: event.target.value }))
                }
                placeholder="0"
              />
            </label>
            <label>
              引き落とし日
              <input
                data-testid="card-date"
                type="date"
                value={cardForm.dueDate}
                onChange={(event) =>
                  setCardForm((form) => ({ ...form, dueDate: event.target.value }))
                }
              />
            </label>
            <label className="wide-field">
              メモ
              <input
                value={cardForm.memo}
                onChange={(event) =>
                  setCardForm((form) => ({ ...form, memo: event.target.value }))
                }
                placeholder="例: EPOS / 楽天 / サブスク多め"
              />
            </label>
            <button className="primary-button" type="submit">
              登録
            </button>
          </form>

          <div className="card-total">
            <span>引き落とし予定</span>
            <strong>{yen.format(totals.cardTotal)}</strong>
          </div>

          <div className="card-plan-list">
            {cardPlans.length > 0 ? (
              cardPlans.map((card) => (
                <article className="card-plan" key={card.id}>
                  <div>
                    <strong>{card.name}</strong>
                    <span>{card.dueDate} / あと{card.daysLeft}日</span>
                    {(card.closingDay || card.memo) && (
                      <small>
                        {card.closingDay ? `${card.closingDay}日締め` : "締め日未設定"}
                        {card.memo ? ` / ${card.memo}` : ""}
                      </small>
                    )}
                  </div>
                  <div>
                    <b>{yen.format(card.amount)}</b>
                    <span>ここまで引くと {yen.format(card.balanceAfter)}</span>
                  </div>
                  <button type="button" onClick={() => removeCard(card.id)} title="削除">
                    x
                  </button>
                </article>
              ))
            ) : (
              <div className="mini-empty">カード予定はまだありません</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("画像ファイルを開けませんでした。"));
    reader.readAsDataURL(file);
  });
}

async function extractTextFromImage(imageUrl, onProgress) {
  const worker = await createWorker("jpn+eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        onProgress(`文字を抽出中... ${Math.round(message.progress * 100)}%`);
      }
    },
  });

  try {
    const result = await worker.recognize(imageUrl);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

async function organizeTextWithAi(text) {
  const prompt = [
    "日本の銀行、カード、決済アプリの明細テキストを整理してください。",
    "返答は1行1明細のテキストだけにしてください。",
    "形式は必ず「日付 | 種類 | 内容 | 金額」です。",
    "種類は 収入, 支出, カード のどれか。",
    "日付は2026-MM-DD形式。月日だけなら2026年として補完。",
    "金額は円の数値だけ。カンマ、円、マイナス記号は付けない。",
    "カード、クレカ、口座振替、ラクテンカード、楽天カード、EPOS、エポスの引き落としはカード。",
    "給料、給与、振込、現金還元、返金は収入。それ以外の出金は支出。",
    "説明文、コードブロック、見出しは不要です。",
    "",
    `明細テキスト:\n${text}`,
  ].join("\n");

  let aiError = null;

  if (window.puter?.ai?.chat) {
    try {
      const result = await window.puter.ai.chat(prompt, { model: "gpt-5-nano" });
      const output = extractAiText(result).trim();
      if (output) return output;
    } catch (error) {
      aiError = error;
    }
  }

  try {
    return organizeTextLocally(text);
  } catch {
    throw new Error(
      aiError
        ? "AI整理に失敗しました。テキストを少し直してから「明細に変換」を押してください。"
        : "AIを読み込めませんでした。テキストを少し直してから「明細に変換」を押してください。"
    );
  }
}

function extractAiText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.text === "string") return result.text;
  if (typeof result?.message?.content === "string") return result.message.content;
  if (Array.isArray(result?.message?.content)) {
    return result.message.content.map((item) => item.text || "").join("");
  }
  if (typeof result?.content === "string") return result.content;
  return "";
}

function organizeTextLocally(text) {
  const rows = parseAiTextRows(text);

  if (rows.length === 0) {
    throw new Error("AIを読み込めませんでした。テキストを少し直してから「明細に変換」を押してください。");
  }

  return rows
    .map((row) => `${row.date} | ${kindLabel(row.kind)} | ${row.title} | ${row.amount}`)
    .join("\n");
}

function kindLabel(kind) {
  if (kind === "income") return "収入";
  if (kind === "card") return "カード";
  return "支出";
}

function daysUntil(dateText) {
  const todayDate = new Date(today());
  const dueDate = new Date(dateText);
  if (Number.isNaN(dueDate.getTime())) return 0;
  const diff = Math.ceil((dueDate - todayDate) / 86400000);
  return Math.max(diff, 0);
}

function parseAiTextRows(text) {
  return text
    .split("\n")
    .map((line) => parseAiTextLine(line))
    .filter(Boolean);
}

function parseAiTextLine(line) {
  const value = line.trim();
  if (!value) return null;

  const parts = value.split("|").map((part) => part.trim());
  if (parts.length >= 4) {
    const kind = toKind(parts[1]);
    const amount = toAmount(parts[3]);
    if (!amount) return null;

    return {
      id: crypto.randomUUID(),
      date: normalizeDate(parts[0]),
      title: parts[2] || (kind === "income" ? "入金" : "出金"),
      amount,
      kind,
    };
  }

  const ocrParsed = parseOcrLine(value);
  if (ocrParsed) return ocrParsed;

  const parsed = parseQuickText(value);
  if (!parsed || parsed.kind === "bank") return null;

  return {
    id: crypto.randomUUID(),
    date: parsed.date || today(),
    title: parsed.title,
    amount: parsed.amount,
    kind: parsed.kind,
  };
}

function parseOcrLine(line) {
  const dateMatch = line.match(/(\d{1,2})[/-](\d{1,2})/);
  const amountMatches = [...line.matchAll(/[-−]?\s*[0-9０-９][0-9０-９,，\s]*\s*円?/g)];
  const amountMatch = amountMatches.at(-1);
  if (!amountMatch) return null;

  const amount = toAmount(amountMatch[0]);
  if (!amount) return null;

  const rawTitle = line
    .replace(dateMatch?.[0] || "", "")
    .replace(amountMatch[0], "")
    .replace(/[|｜]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const isNegative = /^[-−]/.test(amountMatch[0].trim());
  const kind = isNegative ? toKind(rawTitle) : toKind(`収入 ${rawTitle}`);

  return {
    id: crypto.randomUUID(),
    date: dateMatch ? parseDate(dateMatch[0]) : today(),
    title: rawTitle || (kind === "income" ? "入金" : "出金"),
    amount,
    kind,
  };
}

function toKind(text) {
  if (/収入|入金|給料|給与|振込|返金|還元|income/i.test(text)) return "income";
  if (/カード|クレカ|引き落とし|引落|epos|エポス|楽天|card/i.test(text)) return "card";
  return "expense";
}

function toAmount(text) {
  return Math.abs(
    Number(
      String(text)
        .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[^0-9.-]/g, "")
    )
  );
}

function normalizeDate(text) {
  const value = String(text).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return parseDate(value);
}

function SetupScreen({ setupForm, setSetupForm, authError, onSubmit }) {
  function update(key, value) {
    setSetupForm((form) => ({ ...form, [key]: value }));
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">first setup</p>
        <h1>money</h1>
        <form className="setup-form" onSubmit={onSubmit}>
          <label>
            名前
            <input
              value={setupForm.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="例: きょう"
            />
          </label>
          <label>
            ログイン暗証番号
            <input
              type="password"
              inputMode="numeric"
              value={setupForm.passcode}
              onChange={(event) => update("passcode", event.target.value)}
              placeholder="4桁以上"
            />
          </label>
          <label>
            銀行名
            <input
              value={setupForm.bankName}
              onChange={(event) => update("bankName", event.target.value)}
              placeholder="UFJ"
            />
          </label>
          <label>
            今の銀行残高
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={setupForm.bankBalance}
              onChange={(event) => update("bankBalance", event.target.value)}
              placeholder="0"
            />
          </label>
          <label>
            給料日
            <input
              type="number"
              min="1"
              max="31"
              inputMode="numeric"
              value={setupForm.payday}
              onChange={(event) => update("payday", event.target.value)}
            />
          </label>
          <label>
            予定収入
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={setupForm.monthlyIncome}
              onChange={(event) => update("monthlyIncome", event.target.value)}
              placeholder="例: 80000"
            />
          </label>
          <label>
            月予算
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={setupForm.monthlyBudget}
              onChange={(event) => update("monthlyBudget", event.target.value)}
              placeholder="例: 50000"
            />
          </label>
          <label>
            メインカード
            <input
              value={setupForm.mainCard}
              onChange={(event) => update("mainCard", event.target.value)}
              placeholder="楽天カード"
            />
          </label>
          <label>
            カード引き落とし日
            <input
              type="number"
              min="1"
              max="31"
              inputMode="numeric"
              value={setupForm.cardDueDay}
              onChange={(event) => update("cardDueDay", event.target.value)}
            />
          </label>
          {authError && <p className="error-text">{authError}</p>}
          <button className="primary-button" type="submit">
            はじめる
          </button>
        </form>
      </section>
    </main>
  );
}

function LoginScreen({ profile, passcode, setPasscode, authError, onSubmit }) {
  return (
    <main className="auth-page">
      <section className="auth-card login-card">
        <p className="eyebrow">welcome back</p>
        <h1>money</h1>
        <form className="setup-form" onSubmit={onSubmit}>
          <label>
            {profile.name}さんの暗証番号
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              placeholder="暗証番号"
            />
          </label>
          {authError && <p className="error-text">{authError}</p>}
          <button className="primary-button" type="submit">
            ログイン
          </button>
        </form>
      </section>
    </main>
  );
}

function parseQuickText(text) {
  const value = text.trim();
  if (!value) return null;

  const amountText = value.match(/[0-9０-９][0-9０-９,，円\s]*/)?.[0] ?? "";
  const amount = Number(
    amountText
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/[^0-9]/g, "")
  );
  if (!amount) return null;

  const lowerValue = value.toLowerCase();
  const date = parseDate(value);
  const title = value
    .replace(amountText, "")
    .replace(/銀行残高|銀行|残高|カード|クレカ|収入|給料|支出|出費|引き落とし|引落/g, "")
    .replace(/\d{1,2}[/-]\d{1,2}/g, "")
    .trim();

  if (/(銀行|残高)/.test(value)) {
    return { kind: "bank", amount };
  }

  if (/(カード|クレカ|引き落とし|引落)/.test(value)) {
    return { kind: "card", title: title || "カード引き落とし", amount, date };
  }

  if (/(支出|出費|交通費|食費|買い物|コンビニ|サブスク)/.test(value)) {
    return { kind: "expense", title: title || "支出", amount, date };
  }

  if (/(収入|給料|バイト|シフト|salary|income)/.test(lowerValue)) {
    return { kind: "income", title: title || "バイト収入", amount, date };
  }

  return { kind: "expense", title: title || "メモ登録", amount, date };
}

function parseDate(text) {
  const match = text.match(/(\d{1,2})[/-](\d{1,2})/);
  if (!match) return today();

  const year = new Date().getFullYear();
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Summary({ title, value, tone }) {
  return (
    <article className={`summary ${tone}`}>
      <span>{title}</span>
      <strong>{yen.format(value)}</strong>
    </article>
  );
}

function Row({ title, date, amount, type, onRemove }) {
  const sign = type === "income" ? "+" : "-";

  return (
    <article className="row">
      <div>
        <strong>{title}</strong>
        <time>{date}</time>
      </div>
      <div className="row-actions">
        <span className={type}>{sign}{yen.format(amount)}</span>
        <button type="button" onClick={onRemove} aria-label={`${title}を削除`} title="削除">
          x
        </button>
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
