import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));

// Shared Gemini client with required telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// ==========================================
// 1. AI MENTOR CONSULTATION & TICKET PROPOSAL
// ==========================================
app.post('/api/mentor/consult', async (req: Request, res: Response) => {
  try {
    const { userMessage, targetExam, currentStatus, studentProfile } = req.body;

    if (!userMessage) {
      return res.status(400).json({ error: '相談内容を入力してください。' });
    }

    const systemPrompt = `
あなたは自習カフェ「StudyCafe Quest」のチーフ学習メンター＆学習コンシェルジュ「レオン」です。
資格試験（TOEIC、JDLA E資格、基本情報/応用情報、簿記、語学など）に挑む学習者の相談に乗り、温かい激励とプロフェッショナルな学習戦略アドバイスを提供します。

【ミッション】
ユーザーの相談内容（弱点、目標期間、悩み）を分析し：
1. メンターとしての共感と具体的学習メソッド（mentorAdvice）
2. 最適な「マイルストーン（中長期目標）」（proposedMilestone）
3. Redmineライクな「親チケット（大教材・全体周回）」（proposedParentTicket）
4. 親チケットに紐づく実行可能な「子チケット群（3〜4個の具体的行動・時間タスク）」（proposedChildTickets）
を構造化JSONで提案してください。

【トラッカー種別の注意】
- "action": 行動ベース（問、ページ、単語、章 など定量成果）
- "time": 時間ベース（時間単位での講義視聴やシャドーイングなど）

必ず指定のJSONスキーマで返答してください。日本語で出力してください。
`;

    const userPrompt = `
【相談者情報】
- 志望資格・目標: ${targetExam || studentProfile?.targetCertification || '資格学習'}
- 現在の学習状況: ${currentStatus || '学習中'}
- 相談内容: "${userMessage}"
`;

    // Try Gemini API call
    if (process.env.GEMINI_API_KEY) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mentorAdvice: {
                type: Type.STRING,
                description: 'メンターからの励ましと具体的な学習指針（300〜500文字程度）',
              },
              keyStrategy: {
                type: Type.STRING,
                description: '今週の最重要学習ポイント（一言要約）',
              },
              proposedMilestone: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: 'マイルストーン名' },
                  targetExam: { type: Type.STRING, description: '対象試験名' },
                  targetScoreOrRank: { type: Type.STRING, description: '目標スコアまたは合格基準' },
                  targetDate: { type: Type.STRING, description: '目標達成日 (YYYY-MM-DD)' },
                  description: { type: Type.STRING, description: 'マイルストーン概要' },
                  category: { type: Type.STRING, description: 'カテゴリ' },
                  colorHex: { type: Type.STRING, description: 'テーマカラーHEX (例 #d97706, #0284c7)' },
                },
                required: ['title', 'targetExam', 'targetScoreOrRank', 'targetDate', 'description', 'category', 'colorHex'],
              },
              proposedParentTicket: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: '親チケット名（教材や大目標）' },
                  description: { type: Type.STRING, description: '詳細説明' },
                  tracker: { type: Type.STRING, description: 'action または time' },
                  targetValue: { type: Type.NUMBER, description: '目標数量' },
                  unit: { type: Type.STRING, description: '単位 (問, ページ, 時間, 章)' },
                  estimatedHours: { type: Type.NUMBER, description: '予定工数時間' },
                  priority: { type: Type.STRING, description: 'normal または high または urgent' },
                  dueDate: { type: Type.STRING, description: '期日 (YYYY-MM-DD)' },
                },
                required: ['title', 'description', 'tracker', 'targetValue', 'unit', 'estimatedHours', 'priority', 'dueDate'],
              },
              proposedChildTickets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: '子チケット名（日々の具体的タスク）' },
                    description: { type: Type.STRING, description: 'タスク内容' },
                    tracker: { type: Type.STRING, description: 'action または time' },
                    targetValue: { type: Type.NUMBER, description: '目標数量' },
                    unit: { type: Type.STRING, description: '単位' },
                    estimatedHours: { type: Type.NUMBER, description: '予定工数時間' },
                    priority: { type: Type.STRING, description: 'normal または high' },
                    dueDate: { type: Type.STRING, description: '期日 (YYYY-MM-DD)' },
                  },
                  required: ['title', 'description', 'tracker', 'targetValue', 'unit', 'estimatedHours', 'priority', 'dueDate'],
                },
              },
            },
            required: ['mentorAdvice', 'keyStrategy', 'proposedMilestone', 'proposedParentTicket', 'proposedChildTickets'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      return res.json(parsed);
    } else {
      // Deterministic realistic fallback if API key is not yet populated
      const fallback = generateSmartFallbackAdvice(userMessage, targetExam);
      return res.json(fallback);
    }
  } catch (err: unknown) {
    console.error('Error in mentor consultation:', err);
    // Provide structured fallback on any upstream error
    const fallback = generateSmartFallbackAdvice(req.body.userMessage || '', req.body.targetExam);
    return res.json(fallback);
  }
});

function generateSmartFallbackAdvice(userMessage: string, targetExam?: string) {
  const isToeic = /toeic|英語|リスニング|リーディング/i.test(userMessage + ' ' + (targetExam || ''));
  const isDl = /e資格|深層学習|ディープラーニング|ai|python|pytorch/i.test(userMessage + ' ' + (targetExam || ''));

  if (isToeic) {
    return {
      mentorAdvice: `相談ありがとうございます！TOEICのスコアアップでは「Part 5の文法瞬発力」と「Part 3/4のシャドーイング」を同時進行させることが最も効果的です。毎日15分のシャドーイングで耳を英語のリズムに慣らし、Part 5は1問20秒で解く時間感覚を反復ドリルで身につけましょう。カフェの特等席を用意しました。着実に進めていきましょう！`,
      keyStrategy: 'Part 5を1問20秒で解く瞬発力＋1日15分の高速シャドーイング継続',
      proposedMilestone: {
        title: 'TOEIC L&R 800点 突破ブースト',
        targetExam: 'TOEIC Listening & Reading',
        targetScoreOrRank: '820点以上突破',
        targetDate: '2026-11-20',
        description: '時間配分の徹底最適化とPart 3/4リスニングの即時理解を確立する集中プログラム',
        category: '語学・英語',
        colorHex: '#d97706',
      },
      proposedParentTicket: {
        title: '『公式問題集』徹底解き直し & タイムマネジメント',
        description: '公式模試2回分を本番形式で解き、全Partのミス原因をスプレッドシートに記録・反復',
        tracker: 'action',
        targetValue: 200,
        unit: '問',
        estimatedHours: 16,
        priority: 'high',
        dueDate: '2026-11-10',
      },
      proposedChildTickets: [
        {
          title: 'Part 5 空欄補充 40問タイムアタック演習',
          description: '1問20秒以内で解答。品詞判別と語彙コロケーションを即座に言語化。',
          tracker: 'action',
          targetValue: 40,
          unit: '問',
          estimatedHours: 3,
          priority: 'high',
          dueDate: '2026-10-18',
        },
        {
          title: 'リスニング Part 3 1.2倍速シャドーイング特訓',
          description: '会話音声をスクリプトなしで追唱。リエゾンと強勢の完全再現。',
          tracker: 'time',
          targetValue: 6,
          unit: '時間',
          estimatedHours: 6,
          priority: 'high',
          dueDate: '2026-10-25',
        },
        {
          title: 'Part 7 複数文書(ダブル・トリプル) スキャン精読',
          description: '設問先読みから該当箇所をピンポイントで照合する練習。',
          tracker: 'action',
          targetValue: 50,
          unit: '問',
          estimatedHours: 5,
          priority: 'normal',
          dueDate: '2026-11-05',
        },
      ],
    };
  } else if (isDl) {
    return {
      mentorAdvice: `E資格の挑戦、素晴らしい志です！E資格の合否を分けるのは「ブラックボックスに頼らない数理理論の理解」と「NumPyでのレイヤ実装力」です。計算グラフでの逆伝播を手計算した後にコードを書くことで、概念が脳に強固に定着します。まずはAffine/ReLUとCNNの基本から固めましょう！`,
      keyStrategy: '数式展開を手書きノートで導出してからNumPyでクラス化する',
      proposedMilestone: {
        title: 'JDLA E資格 2027#1 合格マスタリー',
        targetExam: 'Deep Learning for ENGINEER',
        targetScoreOrRank: '全シラバス分野 正答率75%以上',
        targetDate: '2027-02-28',
        description: '応用数学・機械学習・深層学習・開発環境の4大分野をスクラッチ実装で完全制覇',
        category: 'AI・データサイエンス',
        colorHex: '#0284c7',
      },
      proposedParentTicket: {
        title: '深層学習コアレイヤのScratch実装トレーニング',
        description: 'CNN・RNN・Attention機構の順伝播・逆伝播をNumPyのみでスクラッチ実装',
        tracker: 'action',
        targetValue: 8,
        unit: 'モジュール',
        estimatedHours: 24,
        priority: 'high',
        dueDate: '2026-11-30',
      },
      proposedChildTickets: [
        {
          title: '計算グラフと誤差逆伝播法の手計算検証',
          description: '行列積の転置と勾配形状の整合性を数式で確認しながらコーディング。',
          tracker: 'time',
          targetValue: 5,
          unit: '時間',
          estimatedHours: 5,
          priority: 'high',
          dueDate: '2026-10-20',
        },
        {
          title: 'Convolution 2D & Pooling層の高速実装 (im2col)',
          description: 'テンソルの展開と逆伝播col2imのロジックを自作して動作テスト。',
          tracker: 'action',
          targetValue: 2,
          unit: 'モジュール',
          estimatedHours: 8,
          priority: 'normal',
          dueDate: '2026-10-31',
        },
        {
          title: '線形代数・SVD・主成分分析の過去問演習',
          description: '固有値分解と分散共分散行列の数式変形を徹底復習。',
          tracker: 'time',
          targetValue: 6,
          unit: '時間',
          estimatedHours: 6,
          priority: 'normal',
          dueDate: '2026-11-15',
        },
      ],
    };
  } else {
    return {
      mentorAdvice: `学習のご相談ありがとうございます！目標達成の秘訣は「大きな目標を小さな日々の行動チケットに分解し、Redmineのように着実に進捗率を積み上げること」です。1日単位で達成できる明確なタスクを組みました。カフェで集中して、1歩ずつ前進しましょう！`,
      keyStrategy: '毎日の学習を25分ブロックに小分けしてストリークを維持する',
      proposedMilestone: {
        title: targetExam ? `${targetExam} 合格ロードマップ` : '資格試験 合格達成マイルストーン',
        targetExam: targetExam || '目標資格試験',
        targetScoreOrRank: '合格基準クリア',
        targetDate: '2026-12-15',
        description: '基礎固めから過去問演習までを体系的にやり切るステップアッププラン',
        category: '資格・自己研鑽',
        colorHex: '#059669',
      },
      proposedParentTicket: {
        title: '主要テキスト1周読破 & 演習問題演習',
        description: '基本テキストの精読と章末問題の全問解答',
        tracker: 'action',
        targetValue: 12,
        unit: '章',
        estimatedHours: 20,
        priority: 'high',
        dueDate: '2026-11-20',
      },
      proposedChildTickets: [
        {
          title: '前半章 (1〜6章) 要点整理ノート作成',
          description: '重要用語と頻出パターンのインプット',
          tracker: 'action',
          targetValue: 6,
          unit: '章',
          estimatedHours: 8,
          priority: 'high',
          dueDate: '2026-10-25',
        },
        {
          title: '過去問演習タイムアタック 3回分',
          description: '時間を測って本番形式で解き直し',
          tracker: 'time',
          targetValue: 6,
          unit: '時間',
          estimatedHours: 6,
          priority: 'normal',
          dueDate: '2026-11-10',
        },
      ],
    };
  }
}

// ==========================================
// 2. LYRIA MUSIC GENERATION (LOFI CAFE BGM)
// ==========================================
app.post('/api/music/generate', async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    const musicPrompt = prompt || 'Cozy acoustic lofi hip hop cafe beats, relaxing vinyl crackle, warm guitar, soft piano, 30 seconds study music';

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
    }

    // Call Lyria music generation model (lyria-3-clip-preview)
    const stream = await ai.models.generateContentStream({
      model: 'lyria-3-clip-preview',
      contents: musicPrompt,
    });

    let audioBase64 = '';
    let mimeType = 'audio/wav';

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (!audioBase64 && part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
          audioBase64 += part.inlineData.data;
        }
      }
    }

    if (!audioBase64) {
      return res.status(500).json({ error: '音楽データの生成に失敗しました。' });
    }

    return res.json({
      audioBase64,
      mimeType,
      message: 'LofiカフェBGMを生成しました！',
    });
  } catch (err: unknown) {
    console.error('Lyria music generation error:', err);
    return res.status(500).json({
      error: 'Lyriaモデルでの生成中にエラーが発生しました。',
    });
  }
});

// ==========================================
// 3. START EXPRESS WITH VITE MIDDLEWARES
// ==========================================
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`StudyCafe Quest server listening on http://localhost:${port}`);
  });
}

startServer();
