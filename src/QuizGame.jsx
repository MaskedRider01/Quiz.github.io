// === 完全版 React JSX QuizGame（再生/停止トグルボタン機能追加） ===
import React, { useEffect, useRef, useState } from "react";

// ===================================
// IndexedDB Helper Functions for Audio
// ===================================

const DB_NAME = 'QuizGameDB';
const STORE_NAME = 'audioStore';
let db;

// IndexedDBを開く
function openDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    
    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };

    request.onupgradeneeded = (event) => {
      const dbInstance = event.target.result;
      if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
        dbInstance.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
  });
}

// 音声ファイル（Blob）をIndexedDBに保存
async function saveAudioToDB(key, file) {
  try {
    const dbInstance = await openDB();
    const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, key);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (error) {
    console.error(`Failed to save ${key}:`, error);
  }
}

// IndexedDBから音声ファイル（Blob）をロード
async function loadAudioFromDB(key) {
  try {
    const dbInstance = await openDB();
    const transaction = dbInstance.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });
  } catch (error) {
    console.warn(`Failed to load ${key}. Assuming not set.`, error);
    return null;
  }
}

// IndexedDBから音源データをクリア
async function clearAudioDB() {
    try {
        const dbInstance = await openDB();
        const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error('Failed to clear IndexedDB:', error);
    }
}


const GROUPS = [
  { id: "red", label: "赤", color: "#e74c3c" },
  { id: "blue", label: "青", color: "#3498db" },
  { id: "green", label: "緑", color: "#2ecc71" },
  { id: "yellow", label: "黄", color: "#f1c40f" },
  { id: "purple", label: "紫", color: "#8e44ad" },
];

// 初期データ生成用関数
const createInitialProblems = () => 
  Array.from({ length: 25 }, (_, i) => ({
    id: i,
    question: `問題 ${i + 1}（サンプル）`,
    choices: ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
    answer: 0,
    groupColor: null,
    used: false,
    score: (Math.floor(i / 5) + 1) * 100,
  }));

export default function QuizGame() {
  // --- State初期化（ローカルストレージから読み込み） ---
  
  const [genres, setGenres] = useState(() => {
    const saved = localStorage.getItem("quiz_genres");
    return saved ? JSON.parse(saved) : ["ジャンル1", "ジャンル2", "ジャンル3", "ジャンル4", "イントロ"];
  });

  const [scores, setScores] = useState(() => {
    const saved = localStorage.getItem("quiz_scores");
    return saved ? JSON.parse(saved) : { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 };
  });

  const [problems, setProblems] = useState(() => {
    const saved = localStorage.getItem("quiz_problems");
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.map(p => ({ ...p, audio: null })); 
    }
    return createInitialProblems();
  });
  
  const [correctSoundUrl, setCorrectSoundUrl] = useState(null);


  // --- IndexedDBからの音源ロード処理 ---
  useEffect(() => {
    const loadAllAudio = async () => {
        // 1. 正解音源のロード
        const correctBlob = await loadAudioFromDB('correctSound');
        if (correctBlob) {
            setCorrectSoundUrl(URL.createObjectURL(correctBlob));
        }

        // 2. イントロ音源のロード
        const newProblems = [...problems];
        let changed = false;
        for (let i = 0; i < newProblems.length; i++) {
            const blob = await loadAudioFromDB(`intro_${i}`);
            if (blob) {
                newProblems[i] = { ...newProblems[i], audio: URL.createObjectURL(blob) };
                changed = true;
            }
        }
        if(changed) {
            setProblems(newProblems);
        }
    };
    loadAllAudio();
  }, []); 

  // --- テキストデータのローカルストレージへの自動保存 ---

  useEffect(() => {
    localStorage.setItem("quiz_genres", JSON.stringify(genres));
  }, [genres]);

  useEffect(() => {
    localStorage.setItem("quiz_scores", JSON.stringify(scores));
  }, [scores]);

  useEffect(() => {
    const problemsToSave = problems.map(p => ({ ...p, audio: null }));
    localStorage.setItem("quiz_problems", JSON.stringify(problemsToSave));
  }, [problems]);


  // --- その他StateとRef ---
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeProblem, setActiveProblem] = useState(null); 
  const [playIndex, setPlayIndex] = useState(null);
  const [showChoices, setShowChoices] = useState(false);
  
  // NEW: 「もう一度再生」ボタンの再生状態を管理
  const [isPlayingAudio, setIsPlayingAudio] = useState(false); 

  const [selectedGroups, setSelectedGroups] = useState([]);
  const [revealOpen, setRevealOpen] = useState(false);

  const audioRef = useRef(null);
  const correctSoundRef = useRef(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) try { audioRef.current.pause(); } catch (e) {}
      if (correctSoundRef.current) try { correctSoundRef.current.pause(); } catch (e) {}
      setIsPlayingAudio(false); // モーダルを閉じるときは再生状態をリセット
    };
  }, []);

  const isIntroIndex = (i) => [4, 9, 14, 19, 24].includes(i);

  const updateProblem = (idx, key, value) => {
    setProblems((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [key]: value };
      return copy;
    });
  };

  const updateChoice = (probIdx, choiceIdx, value) => {
    setProblems((prev) => {
      const copy = [...prev];
      const newChoices = [...copy[probIdx].choices];
      newChoices[choiceIdx] = value;
      copy[probIdx] = { ...copy[probIdx], choices: newChoices };
      return copy;
    });
  };

  const updateGenre = (idx, value) => {
    setGenres((prev) => {
      const c = [...prev];
      c[idx] = value;
      return c;
    });
  };

  const handleIntroUpload = async (e, idx) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    
    await saveAudioToDB(`intro_${idx}`, f);
    
    const url = URL.createObjectURL(f);
    updateProblem(idx, "audio", url);
  };

  const handleCorrectSoundUpload = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    
    await saveAudioToDB('correctSound', f);

    const url = URL.createObjectURL(f);
    setCorrectSoundUrl(url);
    correctSoundRef.current = null;
  };

  const startProblem = (i) => {
    // 既存の音声/タイマーをクリア
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch (e) {}
      audioRef.current = null;
    }
    
    setPlayIndex(i);
    setShowChoices(false); 
    setIsPlayingAudio(false); // 再生状態をリセット

    const intro = isIntroIndex(i);

    if (!intro) {
      // 通常問題: 即座に選択肢を表示
      setShowChoices(true);
      return;
    }

    // イントロ問題: 音源を再生し、手動停止を待つ
    const url = problems[i].audio;
    if (url) {
      const a = new Audio(url);
      audioRef.current = a;
      a.loop = true; 
      a.play().catch(() => {});
      setIsPlayingAudio(true); // イントロ問題開始時は再生状態をONに
    } 
  };
  
  // NEW: 「もう一度再生」ボタンのトグルロジック
  const toggleReplay = () => {
    if (!audioRef.current) return;
    
    if (isPlayingAudio) {
      // 再生中 -> 停止
      try { audioRef.current.pause(); } catch (e) {}
      setIsPlayingAudio(false);
    } else {
      // 停止中 -> 再生
      try { 
        audioRef.current.loop = false; // ループはしない
        audioRef.current.currentTime = 0; 
        audioRef.current.play(); 
        setIsPlayingAudio(true);
        
        // 再生終了時に自動で停止状態に戻すためのイベントリスナー
        audioRef.current.onended = () => {
          setIsPlayingAudio(false);
          audioRef.current.onended = null;
        };
        
      } catch (e) {
        setIsPlayingAudio(false);
      }
    }
  };


  const playCorrectSound = () => {
    try {
      if (correctSoundUrl) {
        if (!correctSoundRef.current) correctSoundRef.current = new Audio(correctSoundUrl);
        correctSoundRef.current.currentTime = 0;
        correctSoundRef.current.play().catch(() => {});
      } else {
        // デフォルト音の再生
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.setValueAtTime(880, ctx.currentTime);
          g.gain.setValueAtTime(0.0001, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
          o.connect(g); g.connect(ctx.destination);
          o.start();
          setTimeout(() => { o.stop(); ctx.close(); }, 300);
        } catch (e) {}
      }
    } catch (e) {}
  };

  const toggleGroupSelect = (gid) => {
    setSelectedGroups((prev) => (prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid]));
  };

  const confirmMultipleCorrect = () => {
    if (playIndex === null) return;
    const pts = problems[playIndex].score;

    setScores((prev) => {
      const ns = { ...prev };
      selectedGroups.forEach((g) => (ns[g] = (ns[g] || 0) + pts));
      return ns;
    });

    setProblems((prev) => {
      const cp = [...prev];
      cp[playIndex] = {
        ...cp[playIndex],
        used: true,
        groupColor: selectedGroups.length === 1 ? GROUPS.find((x) => x.id === selectedGroups[0]).color : "#444",
      };
      return cp;
    });
    
    setRevealOpen(false);
    setSelectedGroups([]);

    if (audioRef.current) try { audioRef.current.pause(); } catch (e) {}
    setIsPlayingAudio(false); 

    setPlayIndex(null);
    setShowChoices(false);
  };

  // スコアと使用済みフラグのみをリセットする関数
  const resetScoresAndUsage = () => {
    if (!window.confirm("現在のスコアと問題の使用状態（使用済みパネルの色）をリセットし、最初からゲームをやり直しますか？\n問題の編集内容や音源は保持されます。")) return;
    
    setScores({ red: 0, blue: 0, green: 0, yellow: 0, purple: 0 });

    setProblems(prev => prev.map(p => ({ 
      ...p, 
      used: false, 
      groupColor: null 
    })));
  };

  // FULL RESET: 全てを初期化する関数
  const resetGame = async () => {
    if (!window.confirm("【警告】\n全てのデータを完全に初期化します。スコア、問題文、ジャンル名、**アップロードした音源**も全て消えますがよろしいですか？")) return;
    
    localStorage.removeItem("quiz_genres");
    localStorage.removeItem("quiz_scores");
    localStorage.removeItem("quiz_problems");
    
    await clearAudioDB();

    setScores({ red: 0, blue: 0, green: 0, yellow: 0, purple: 0 });
    setGenres(["ジャンル1", "ジャンル2", "ジャンル3", "ジャンル4", "イントロ"]);
    setProblems(createInitialProblems());
    setCorrectSoundUrl(null);
  };

  const ranking = Object.entries(scores)
    .map(([id, score]) => ({ id, score, label: GROUPS.find((g) => g.id === id).label }))
    .sort((a, b) => b.score - a.score);

  return (
    <div style={{ width: "100vw", minHeight: "100vh", background: "#660000", color: "white", padding: 24, boxSizing: "border-box", fontFamily: "sans-serif" }}>

      <div style={{ position: "fixed", top: 16, left: 16, display: "flex", gap: 8 }}>
        <button style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer" }} onClick={() => setSettingsOpen(true)}>設定</button>
        <button style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", background: "#f39c12", color: "#fff", border: "1px solid #999" }} onClick={resetScoresAndUsage}>スコアリセット</button> 
        <button style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", background: "#e74c3c", color: "#fff", border: "1px solid #999" }} onClick={resetGame}>全データ削除</button>
      </div>

      <div style={{ position: "fixed", top: 16, right: 16, width: 220, background: "rgba(0,0,0,0.5)", padding: 12, borderRadius: 8 }}>
        <h3 style={{ margin: "0 0 8px 0", textAlign: "center", borderBottom: "1px solid #aaa", paddingBottom: 4 }}>ランキング</h3>
        {ranking.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
               <div style={{ width: 10, height: 10, borderRadius: "50%", background: GROUPS.find(g => g.id === r.id).color, marginRight: 8 }}></div>
               {r.label}
            </div>
            <div style={{ fontWeight: 700 }}>{r.score}</div>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 1000, margin: "80px auto 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, textAlign: "center", fontWeight: 700 }}>
          {genres.map((g, i) => (
            <div key={i} style={{ padding: 12, background: "linear-gradient(#444, #222)", borderRadius: 8, border: "1px solid #666" }}>{g}</div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginTop: 12 }}>
          {problems.map((p, i) => (
            <div key={i} style={{ 
              background: p.groupColor ? p.groupColor : "rgba(255,255,255,0.1)", 
              borderRadius: 12, 
              padding: 12, 
              height: 100, 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              justifyContent: "center",
              border: p.used ? "2px solid rgba(0,0,0,0.3)" : "2px solid rgba(255,255,255,0.1)"
            }}>
              <div style={{ fontSize: 24, fontWeight: "bold", opacity: p.used ? 0.5 : 1 }}>{p.score}</div>
              {!p.used && (
                <button 
                  style={{ marginTop: 8, padding: "4px 12px", borderRadius: 20, cursor: "pointer", border: "none", background: "#fff", color: "#333", fontWeight: "bold" }} 
                  onClick={() => startProblem(i)}
                >
                  START
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {playIndex !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 100 }}>
          <div style={{ width: "90vw", maxWidth: 1000, background: "#fff", color: "#333", borderRadius: 16, padding: 32, position: "relative", minHeight: "60vh", display: "flex", flexDirection: "column" }}>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, borderBottom: "2px solid #eee", paddingBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 32 }}>問題 {playIndex + 1} <span style={{fontSize: 20, color: "#666"}}>({problems[playIndex].score} pts)</span></h2>
              <button onClick={() => { setPlayIndex(null); setIsPlayingAudio(false);}} style={{ padding: "8px 16px", cursor: "pointer" }}>閉じる</button>
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
              <div style={{ fontSize: 36, fontWeight: "bold", marginBottom: 32, lineHeight: 1.4 }}>
                {problems[playIndex].question}
              </div>

              {isIntroIndex(playIndex) && !showChoices && (
                <div style={{ fontSize: 48, color: isPlayingAudio ? "#e74c3c" : "#3498db", fontWeight: "bold", marginBottom: 32 }}>
                  {isPlayingAudio ? "♪ イントロ再生中..." : "■ 再生停止中"}
                </div>
              )}
            </div>

            {showChoices && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 24 }}>
                {problems[playIndex].choices.map((c, idx) => (
                  <div key={idx} style={{ 
                    padding: 24, 
                    background: "#f5f5f5", 
                    borderRadius: 12, 
                    fontSize: 24, 
                    fontWeight: "bold",
                    textAlign: "center",
                    border: "2px solid #ddd",
                    position: "relative"
                  }}>
                    <span style={{ position: "absolute", left: 16, top: 16, color: "#999" }}>{["A","B","C","D"][idx]}</span>
                    {c}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 16 }}>
               {isIntroIndex(playIndex) && !showChoices ? (
                 // --- イントロ再生中のボタン ---
                 <button 
                   onClick={() => {
                       if (audioRef.current) { 
                         audioRef.current.pause(); 
                         audioRef.current.loop = false;
                       }
                       setIsPlayingAudio(false); // 再生状態を停止に
                       setShowChoices(true);
                   }} 
                   style={{ padding: "12px 32px", fontSize: 18, cursor: "pointer", background: "#3498db", color: "white", border: "none", borderRadius: 8 }}
                 >
                   ■ 再生停止 / 選択肢表示
                 </button>
               ) : (
                 // --- 選択肢表示後（共通）のボタン ---
                 <>
                   {problems[playIndex].audio && (
                     // NEW: もう一度再生ボタンのトグルロジック
                     <button 
                       onClick={toggleReplay} 
                       style={{ 
                         padding: "12px 24px", 
                         fontSize: 18, 
                         cursor: "pointer", 
                         background: isPlayingAudio ? "#e74c3c" : "#f1c40f", 
                         color: "black", 
                         border: "none", 
                         borderRadius: 8 
                       }}
                     >
                       {isPlayingAudio ? "■ 再生停止" : "♪ もう一度再生"}
                     </button>
                   )}
                   
                   <button 
                     onClick={() => {
                       playCorrectSound(); 
                       setRevealOpen(true); 
                       if (audioRef.current) try { audioRef.current.pause(); setIsPlayingAudio(false); } catch (e) {}
                     }} 
                     style={{ padding: "12px 32px", fontSize: 18, cursor: "pointer", background: "#e74c3c", color: "white", border: "none", borderRadius: 8 }}
                   >
                     正解発表へ
                   </button>
                 </>
               )}
            </div>

            {revealOpen && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.95)", borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
                <h2>正解： {problems[playIndex].choices[problems[playIndex].answer]}</h2>
                <p>正解したチームを選択してください（複数可）</p>
                <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                  {GROUPS.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => toggleGroupSelect(g.id)}
                      style={{
                        padding: "16px 24px",
                        fontSize: 18,
                        borderRadius: 8,
                        border: selectedGroups.includes(g.id) ? "4px solid #000" : "1px solid #ccc",
                        background: g.color,
                        color: "white",
                        cursor: "pointer",
                        opacity: selectedGroups.includes(g.id) ? 1 : 0.6,
                        transform: selectedGroups.includes(g.id) ? "scale(1.1)" : "scale(1)"
                      }}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  <button onClick={() => setRevealOpen(false)} style={{ padding: "12px 24px", fontSize: 16 }}>キャンセル</button>
                  <button onClick={confirmMultipleCorrect} style={{ padding: "12px 32px", fontSize: 18, background: "#2ecc71", color: "white", border: "none", borderRadius: 8 }}>
                    確定して得点付与
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {settingsOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 200 }}>
          <div style={{ width: "90vw", height: "90vh", background: "white", color: "black", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>設定</h2>
              <button onClick={() => setSettingsOpen(false)}>閉じる</button>
            </div>
            
            <div style={{ flex: 1, overflowY: "auto", paddingRight: 8 }}>
              <div style={{ marginBottom: 24, padding: 16, background: "#f9f9f9", borderRadius: 8 }}>
                <h3>ジャンル名</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                  {genres.map((g, i) => (
                    <input key={i} value={g} onChange={(e) => updateGenre(i, e.target.value)} style={{ flex: 1, padding: 8 }} />
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 24, padding: 16, background: "#f9f9f9", borderRadius: 8 }}>
                <h3>正解効果音 (永続保存されます)</h3>
                <input type="file" accept="audio/*" onChange={handleCorrectSoundUpload} />
                {correctSoundUrl && <span style={{ color: "green", marginLeft: 8 }}>✓ アップロード済み</span>}
              </div>

              <h3>問題編集 (全25問)</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 16 }}>
                 {problems.map((p, i) => (
                   <button 
                     key={i} 
                     onClick={() => setActiveProblem(i)}
                     style={{ 
                       padding: 8, 
                       background: activeProblem === i ? "#333" : "#eee", 
                       color: activeProblem === i ? "#fff" : "#333",
                       border: "1px solid #ccc",
                       cursor: "pointer"
                     }}
                   >
                     {i + 1}. {p.score}pt
                   </button>
                 ))}
              </div>

              {activeProblem !== null && (
                <div style={{ border: "2px solid #333", padding: 20, borderRadius: 8, background: "#fff" }}>
                  <h4 style={{ marginTop: 0 }}>問題 {activeProblem + 1} の編集</h4>
                  
                  <div style={{ marginBottom: 12 }}>
                    <label style={{display:"block", fontWeight:"bold"}}>問題文:</label>
                    <textarea 
                      style={{ width: "100%", height: 60, padding: 8 }} 
                      value={problems[activeProblem].question}
                      onChange={(e) => updateProblem(activeProblem, "question", e.target.value)}
                    />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{display:"block", fontWeight:"bold"}}>選択肢 (4つ):</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {problems[activeProblem].choices.map((c, cIdx) => (
                        <input 
                          key={cIdx}
                          value={c}
                          onChange={(e) => updateChoice(activeProblem, cIdx, e.target.value)}
                          placeholder={`選択肢 ${["A","B","C","D"][cIdx]}`}
                          style={{ padding: 8 }}
                        />
                      ))}
                    </div>
                  </div>

                  <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 16 }}>
                    <div>
                      <label style={{ fontWeight:"bold", marginRight: 8 }}>正解:</label>
                      <select 
                        value={problems[activeProblem].answer} 
                        onChange={(e) => updateProblem(activeProblem, "answer", Number(e.target.value))}
                        style={{ padding: 8 }}
                      >
                        {problems[activeProblem].choices.map((_, idx) => (
                          <option key={idx} value={idx}>
                            {["A","B","C","D"][idx]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isIntroIndex(activeProblem) && (
                      <div style={{ background: "#ffebee", padding: "8px 16px", borderRadius: 8 }}>
                        <label style={{ fontWeight:"bold", marginRight: 8, color: "#c62828" }}>イントロ音源 (永続保存されます):</label>
                        <input type="file" accept="audio/*" onChange={(e) => handleIntroUpload(e, activeProblem)} />
                        {problems[activeProblem].audio && <span style={{fontSize: 12}}>🎵設定済</span>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}