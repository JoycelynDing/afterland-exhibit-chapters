/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence, useAnimationControls } from "motion/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from "react";
import { Story } from "inkjs";
import { Flame, LibraryBig, Package, Sparkles, Settings2 } from "lucide-react";
import { StoryProvider } from "./components/narrative/StoryContext";
import { JournalPage } from "./components/narrative/JournalPage";
import afterlandLogo from "./assets/afterland-logo.png";
import chapterOnePageArt from "./assets/chapter-1-page-art.png";
import chapterTwoPageArt from "./assets/chapter-2-page-art.png";
import chapterSceneOne from "./assets/chapter-scene-1.png";
import chapterSceneTwo from "./assets/chapter-scene-2.png";
import chapterSceneThree from "./assets/chapter-scene-3.png";
import chapterTitleHoverBrush from "./assets/chapter-title-hover-brush.png";
import diaryArrowNext from "./assets/diary-arrow-next.png";
import diaryArrowPrev from "./assets/diary-arrow-prev.png";
import diaryOpenBook from "./assets/diary-open-book.png";
import diarySceneBg from "./assets/diary-scene-bg.png";
import diaryTab from "./assets/diary-tab.png";
import homeHubImage from "./assets/home-hub.png";
import quickMenuDial from "./assets/quick-menu-dial.png";
import quickMenuIconCodex from "./assets/quick-menu-icon-codex.png";
import quickMenuIconHandbook from "./assets/quick-menu-icon-handbook.png";
import quickMenuIconItems from "./assets/quick-menu-icon-items.png";
import quickMenuIconMap from "./assets/quick-menu-icon-map.png";
import chapter00Music from "./assets/chapter00.mp3";
import chapter0aMusic from "./assets/chapter0a.mp3";
import chapter0bMusic from "./assets/chapter0b.mp3";
import {
  C002_RELIC_ID,
  COLLECTIBLE_CLUES,
  COLLECTIBLE_CLUE_IDS,
  STORY_COLLECTIBLE_TRIGGERS_BY_CHAPTER_ID,
  getCollectibleClue,
  getStoryInlineImageConfig,
  isStoryMediaMarkerText,
  type CollectibleClueId,
  type CollectibleClueConfig,
} from "./storyMedia";
import { storageGetItem, storageKeys, storageRemoveItem, storageSetItem } from "./utils/safeStorage";
import afterlandStoryData from "./narrative/afterland.ink.json";
import storyData from "./narrative/sample.json";

type Language = "zh" | "en";
type BodyTextSize = "small" | "medium" | "large";
type AppView = "landing" | "home" | "detailed";
type DesktopPanelId = "artifacts" | "items" | "codex" | "map";

type LocalizedCopy = Record<Language, string>;

type ChapterContent = {
  id: string;
  title: LocalizedCopy;
  order: string;
  date: string;
  textContent: LocalizedCopy;
  imageSlot: string;
  storyPath?: string;
};

type MemoryStartRequest = {
  chapterId: string;
  requestId: number;
};

const copy = (zh: string, en: string): LocalizedCopy => ({ zh, en });

const storyCharacterCountCache = new Map<string, number>();
const CHAPTER_BOUNDARY_CHOICE_PATTERN = /翻到下一篇|下一篇日记|开启下一章|进入下一章|下一章|next\s+(?:chapter|entry)/i;

const isChapterBoundaryChoiceText = (text: string) => CHAPTER_BOUNDARY_CHOICE_PATTERN.test(text.trim());

const countReachableStoryCharacters = (storyJson: unknown, storyInstance: Story, depth = 0): number => {
  if (depth > 24) {
    return 0;
  }

  let total = 0;

  while (storyInstance.canContinue) {
    const line = storyInstance.Continue().trim();
    total += isStoryMediaMarkerText(line) ? 0 : line.length;
  }

  if (storyInstance.currentChoices.length === 0) {
    return total;
  }

  if (storyInstance.currentChoices.every((choice) => isChapterBoundaryChoiceText(choice.text))) {
    return total;
  }

  const branchTotals = storyInstance.currentChoices.map((_, choiceIndex) => {
    const branchStory = new Story(storyJson as any);
    branchStory.state.LoadJson(storyInstance.state.ToJson());
    branchStory.ChooseChoiceIndex(choiceIndex);
    return countReachableStoryCharacters(storyJson, branchStory, depth + 1);
  });

  return total + Math.max(...branchTotals, 0);
};

const countInkStoryCharacters = (storyJson: unknown, initialPath?: string) => {
  const cacheKey = initialPath ? `path:${initialPath}` : "root";
  const cachedCount = storyCharacterCountCache.get(cacheKey);

  if (cachedCount) {
    return cachedCount;
  }

  if (initialPath) {
    try {
      const storyInstance = new Story(storyJson as any);
      storyInstance.ChoosePathString(initialPath);
      const total = Math.max(countReachableStoryCharacters(storyJson, storyInstance), 1);
      storyCharacterCountCache.set(cacheKey, total);
      return total;
    } catch (error) {
      console.warn(`Failed to count Ink characters from path "${initialPath}":`, error);
    }
  }

  let total = 0;

  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (value.startsWith("^")) {
        const line = value.slice(1).trim();
        total += isStoryMediaMarkerText(line) ? 0 : line.length;
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };

  walk(storyJson);
  const fallbackTotal = Math.max(total, 1);
  storyCharacterCountCache.set(cacheKey, fallbackTotal);
  return fallbackTotal;
};

const BODY_TEXT_SIZE_PT: Record<BodyTextSize, number> = {
  small: 10,
  medium: 12,
  large: 14,
};

const STORY_BY_CHAPTER_ID: Record<string, any> = {
  "CH-00": afterlandStoryData,
  "CH-01": afterlandStoryData,
  "CH-02": afterlandStoryData,
  "ITEM-MEM-01": storyData,
  "ITEM-MEM-02": storyData,
  "ITEM-MEM-03": storyData,
  "ITEM-MEM-04": storyData,
  "ITEM-MEM-05": storyData,
  "ITEM-MEM-06": storyData,
};

const CHAPTER_MUSIC_BY_CHAPTER_ID: Partial<Record<string, string>> = {
  "CH-00": chapter00Music,
  "CH-01": chapter0aMusic,
  "CH-02": chapter0bMusic,
};

const CHAPTER_MUSIC_FADE_MS = 900;
const CHAPTER_MUSIC_CROSSFADE_SECONDS = 4;
const STORY_STORAGE_VERSION = "afterland-main-v3";

const getStoryStorageKey = (chapterId: string) => `afterland-story-state-${STORY_STORAGE_VERSION}-${chapterId}`;
const getReaderStorageKey = (chapterId: string) => `afterland-reader-progress-${STORY_STORAGE_VERSION}-${chapterId}`;
const getChapterCompletionKey = (chapterId: string) => `afterland-reader-complete-${STORY_STORAGE_VERSION}-${chapterId}`;
const getChapterUnlockKey = (chapterId: string) => `afterland-reader-unlocked-${STORY_STORAGE_VERSION}-${chapterId}`;
const GAME_SAVE_STORAGE_KEY = "afterland-game-save";
const GAME_SAVE_SLOTS_STORAGE_KEY = "afterland-save-slots";
const LANGUAGE_STORAGE_KEY = "afterland-language";
const BODY_TEXT_SIZE_STORAGE_KEY = "afterland-body-text-size";
const MUSIC_ENABLED_STORAGE_KEY = "afterland-music-enabled";
const MUSIC_VOLUME_STORAGE_KEY = "afterland-music-volume";
const SFX_ENABLED_STORAGE_KEY = "afterland-sfx-enabled";
const AUTO_PLAY_ENABLED_STORAGE_KEY = "afterland-auto-play-enabled";
const AUTO_PLAY_SPEED_STORAGE_KEY = "afterland-auto-play-speed";
const MAX_PLAYTHROUGH_SAVE_SLOTS = 6;
const PRESERVED_GLOBAL_STORAGE_KEYS = new Set([
  LANGUAGE_STORAGE_KEY,
  BODY_TEXT_SIZE_STORAGE_KEY,
  MUSIC_ENABLED_STORAGE_KEY,
  MUSIC_VOLUME_STORAGE_KEY,
  SFX_ENABLED_STORAGE_KEY,
  AUTO_PLAY_ENABLED_STORAGE_KEY,
  AUTO_PLAY_SPEED_STORAGE_KEY,
  GAME_SAVE_SLOTS_STORAGE_KEY,
]);

const isDesktopPanelId = (value: unknown): value is DesktopPanelId =>
  value === "artifacts" || value === "items" || value === "codex" || value === "map";

const readStoredValue = (key: string) => {
  if (typeof window === "undefined") {
    return null;
  }

  return storageGetItem(key);
};

const readStoredLanguage = (): Language => {
  const value = readStoredValue(LANGUAGE_STORAGE_KEY);
  return value === "zh" || value === "en" ? value : "zh";
};

const readStoredBodyTextSize = (): BodyTextSize => {
  const value = readStoredValue(BODY_TEXT_SIZE_STORAGE_KEY);
  return value === "small" || value === "medium" || value === "large" ? value : "medium";
};

const readStoredBoolean = (key: string, fallback: boolean) => {
  const value = readStoredValue(key);

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
};

const readStoredVolume = () => {
  const value = Number(readStoredValue(MUSIC_VOLUME_STORAGE_KEY));

  if (!Number.isFinite(value)) {
    return 68;
  }

  return Math.min(100, Math.max(0, value));
};

const readStoredAutoPlaySpeed = () => {
  const value = Number(readStoredValue(AUTO_PLAY_SPEED_STORAGE_KEY));

  if (!Number.isFinite(value)) {
    return 62;
  }

  return Math.min(100, Math.max(0, value));
};

function getNarrativeChapters() {
  return [...chapters, ...itemMemoryChapters];
}

function findNarrativeChapterById(chapterId: string) {
  return getNarrativeChapters().find((chapter) => chapter.id === chapterId);
}

type GameSaveState = {
  view: Exclude<AppView, "landing">;
  activeTab: DesktopPanelId;
  activeChapterId: string;
  isEchoing: boolean;
};

type ExhibitionMode = {
  slug: "ch1" | "ch2" | "ch3";
  chapterId: string;
};

type PlaythroughSaveSlot = {
  id: string;
  savedAt: string;
  storage: Record<string, string>;
};

const EXHIBITION_QUERY_TO_CHAPTER_ID = {
  "1": "CH-00",
  "2": "CH-01",
  "3": "CH-02",
  ch1: "CH-00",
  ch2: "CH-01",
  ch3: "CH-02",
} as const;

const EXHIBITION_LOCKED_NOTICE = "展览限制不可交互  此功能将在完整版游戏中上线";

const readExhibitionMode = (): ExhibitionMode | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const query = new URLSearchParams(window.location.search);
  const exhibitParam = query.get("exhibit")?.trim().toLowerCase();

  if (!exhibitParam) {
    return null;
  }

  const chapterId = EXHIBITION_QUERY_TO_CHAPTER_ID[exhibitParam as keyof typeof EXHIBITION_QUERY_TO_CHAPTER_ID];

  if (!chapterId) {
    return null;
  }

  const slug = exhibitParam.startsWith("ch") ? exhibitParam : `ch${exhibitParam}`;
  if (slug !== "ch1" && slug !== "ch2" && slug !== "ch3") {
    return null;
  }

  return { slug, chapterId };
};

const getExhibitionStoryStorageKey = (slug: ExhibitionMode["slug"], chapterId: string) =>
  `afterlanddemo-story-state-v4-${slug}-${chapterId}`;
const getExhibitionReaderStorageKey = (slug: ExhibitionMode["slug"], chapterId: string) =>
  `afterlanddemo-reader-progress-v4-${slug}-${chapterId}`;

const clearReaderProgress = ({
  storyStorageKey,
  readerStorageKey,
}: {
  storyStorageKey?: string;
  readerStorageKey?: string;
}) => {
  if (storyStorageKey) {
    storageRemoveItem(storyStorageKey);
  }
  if (readerStorageKey) {
    storageRemoveItem(readerStorageKey);
  }
};

const clearChapterProgress = (chapterId: string) => {
  clearReaderProgress({
    storyStorageKey: getStoryStorageKey(chapterId),
    readerStorageKey: getReaderStorageKey(chapterId),
  });
};

const clearAllGameplayProgress = () => {
  storageKeys().forEach((key) => {
    if (key.startsWith("afterland-") && !PRESERVED_GLOBAL_STORAGE_KEYS.has(key)) {
      storageRemoveItem(key);
    }
  });
};

const collectGameplayStorageSnapshot = () => {
  const snapshot: Record<string, string> = {};

  storageKeys().forEach((key) => {
    if (!key.startsWith("afterland-") || PRESERVED_GLOBAL_STORAGE_KEYS.has(key)) {
      return;
    }

    const value = storageGetItem(key);
    if (value !== null) {
      snapshot[key] = value;
    }
  });

  return snapshot;
};

const restoreGameplayStorageSnapshot = (snapshot: Record<string, string>) => {
  clearAllGameplayProgress();
  Object.entries(snapshot).forEach(([key, value]) => {
    if (!PRESERVED_GLOBAL_STORAGE_KEYS.has(key)) {
      storageSetItem(key, value);
    }
  });
};

const readPlaythroughSaveSlots = (): PlaythroughSaveSlot[] => {
  const raw = storageGetItem(GAME_SAVE_SLOTS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const slots = JSON.parse(raw) as Partial<PlaythroughSaveSlot>[];
    if (!Array.isArray(slots)) return [];

    return slots
      .filter(
        (slot): slot is PlaythroughSaveSlot =>
          typeof slot.id === "string" &&
          typeof slot.savedAt === "string" &&
          Boolean(slot.storage) &&
          typeof slot.storage === "object",
      )
      .slice(0, MAX_PLAYTHROUGH_SAVE_SLOTS);
  } catch {
    storageRemoveItem(GAME_SAVE_SLOTS_STORAGE_KEY);
    return [];
  }
};

const writePlaythroughSaveSlots = (slots: PlaythroughSaveSlot[]) => {
  storageSetItem(GAME_SAVE_SLOTS_STORAGE_KEY, JSON.stringify(slots.slice(0, MAX_PLAYTHROUGH_SAVE_SLOTS)));
};

const readGameSaveState = (): GameSaveState | null => {
  const savedRaw = storageGetItem(GAME_SAVE_STORAGE_KEY);
  if (!savedRaw) return null;

  try {
    const saved = JSON.parse(savedRaw) as Partial<GameSaveState>;
    const view = saved.view === "detailed" ? "detailed" : saved.view === "home" ? "home" : null;
    const activeChapterId =
      typeof saved.activeChapterId === "string" && Boolean(findNarrativeChapterById(saved.activeChapterId))
        ? saved.activeChapterId
        : chapters[0].id;

    if (!view) return null;

    return {
      view,
      activeTab: isDesktopPanelId(saved.activeTab) ? saved.activeTab : "artifacts",
      activeChapterId,
      isEchoing: Boolean(saved.isEchoing),
    };
  } catch {
    storageRemoveItem(GAME_SAVE_STORAGE_KEY);
    return null;
  }
};

const readGameSaveStateFromStorage = (storage: Record<string, string>): GameSaveState | null => {
  const savedRaw = storage[GAME_SAVE_STORAGE_KEY];
  if (!savedRaw) return null;

  try {
    const saved = JSON.parse(savedRaw) as Partial<GameSaveState>;
    const view = saved.view === "detailed" ? "detailed" : saved.view === "home" ? "home" : null;
    const activeChapterId =
      typeof saved.activeChapterId === "string" && Boolean(findNarrativeChapterById(saved.activeChapterId))
        ? saved.activeChapterId
        : chapters[0].id;

    if (!view) return null;

    return {
      view,
      activeTab: isDesktopPanelId(saved.activeTab) ? saved.activeTab : "artifacts",
      activeChapterId,
      isEchoing: Boolean(saved.isEchoing),
    };
  } catch {
    return null;
  }
};

const formatSaveSlotTimestamp = (savedAt: string, language: Language) => {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return savedAt;

  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const getSaveSlotCompletedCount = (slot: PlaythroughSaveSlot) =>
  chapters.filter((chapter) => slot.storage[getChapterCompletionKey(chapter.id)] === "true").length;

const UI_COPY = {
  zh: {
    landing: {
      startGame: "开始游戏",
      newGame: "新游戏",
      settings: "设置",
      saves: "存档",
      close: "关闭",
      language: "语言",
      musicVolume: "音乐音量",
    },
    home: {
      hub: "枢纽",
      journalArchive: "手札",
      relic: "物品",
      codex: "图鉴",
      map: "地图",
      backToLanding: "回到首页",
    },
    detail: {
      chapterIndex: "章节索引",
      backToHub: "回到桌面",
      backToChapter: "返回章节",
      subtitle: "界面考古学",
      drawer: "抽屉",
      chronicles: "编年史",
      journalArchive: "日记档案",
      cartography: "测绘图",
      syncing: "叙事同步中...",
      startEcho: "开始游戏",
      scanData: "环境扫描数据",
      exitEcho: "终端中断回响",
      choicePrefix: "回响抉择：",
      continueHint: "点击屏幕继续",
      narrativeEnded: "叙事已断裂在时空的断层中",
      tutorial: {
        advance: "点击笔记本空白处，继续回响剧情",
        choice: "选择一个回忆分支继续探索，可能会有不一样的后续",
        nextPage: "这一页已经写满，点击右下角箭头翻到下一页",
        prevPage: "左下角箭头可以返回上一页，回看刚才的内容",
      },
      signalStrength: "信号强度",
      syncError: "同步误差",
      returnDesktop: "返回桌面",
    },
    settings: {
      title: "设置",
      language: "语言",
      bodyTextSize: "正文字号",
      autoPlay: "自动播放",
      autoPlaySpeed: "速度",
      music: "音乐",
      musicVolume: "音量",
      soundEffects: "音效",
      on: "开",
      off: "关",
      chinese: "中文",
      english: "English",
      small: "小",
      medium: "中",
      large: "大",
    },
    saves: {
      title: "存档",
      emptySlot: "空槽位",
      load: "继续",
      noSaves: "暂无保存的周目",
      slotLabel: "存档",
      savedAt: "保存于",
      overwriteHint: "最多保存 6 个进度；超过后会自动替换最早的存档。",
      newGameTitle: "开始新游戏？",
      newGameBody: "是否先保存当前周目进度？这会保存阅读进度、人物好感度，以及线索/故事解锁程度。",
      saveAndStart: "保存并开始",
      startWithoutSave: "不保存，开始",
      cancel: "取消",
      restored: "已载入",
      currentChapter: "当前章节",
    },
  },
  en: {
    landing: {
      startGame: "Start Game",
      newGame: "New Game",
      settings: "Settings",
      saves: "Saves",
      close: "Close",
      language: "Language",
      musicVolume: "Music Volume",
    },
    home: {
      hub: "Hub",
      journalArchive: "Handbook",
      relic: "Items",
      codex: "Codex",
      map: "Map",
      backToLanding: "Back to Title",
    },
    detail: {
      chapterIndex: "Chapter Index",
      backToHub: "Back to Hub [ESC]",
      backToChapter: "Back to Chapter",
      subtitle: "Interface Archaeology",
      drawer: "Drawer",
      chronicles: "Chronicles",
      journalArchive: "Journal Archive",
      cartography: "Cartography",
      syncing: "Narrative Syncing...",
      startEcho: "Start Game",
      scanData: "Environmental Scan",
      exitEcho: "Exit Echo",
      choicePrefix: "Echo Choice:",
      continueHint: "Click to Continue",
      narrativeEnded: "The narrative has fractured along the fault line of time.",
      tutorial: {
        advance: "Click the blank notebook space to continue the echo.",
        choice: "Choose a memory branch to keep exploring; the path may unfold differently.",
        nextPage: "This page is full. Use the lower-right arrow to turn the page.",
        prevPage: "The lower-left arrow returns to the previous page.",
      },
      signalStrength: "Signal Strength",
      syncError: "Sync Error",
      returnDesktop: "Return to Desktop",
    },
    settings: {
      title: "Settings",
      language: "Language",
      bodyTextSize: "Body Size",
      autoPlay: "Auto Play",
      autoPlaySpeed: "Speed",
      music: "Music",
      musicVolume: "Volume",
      soundEffects: "SFX",
      on: "On",
      off: "Off",
      chinese: "中文",
      english: "English",
      small: "Small",
      medium: "Medium",
      large: "Large",
    },
    saves: {
      title: "Saves",
      emptySlot: "Empty Slot",
      load: "Continue",
      noSaves: "No saved playthroughs yet",
      slotLabel: "Save",
      savedAt: "Saved",
      overwriteHint: "Up to 6 saves are kept; the oldest save is replaced when full.",
      newGameTitle: "Start a new game?",
      newGameBody: "Save the current playthrough first? This preserves reading progress, affinity, clues, and story unlocks.",
      saveAndStart: "Save & Start",
      startWithoutSave: "Start Without Saving",
      cancel: "Cancel",
      restored: "Loaded",
      currentChapter: "Chapter",
    },
  },
} as const;

const chapters: ChapterContent[] = [
  {
    id: "CH-00",
    title: copy("草原的孩子", "Child of the Grassland"),
    order: "I",
    date: "318Y·4D·22R",
    textContent: copy(
      "一切开始的那一天。\n从这里开始，回响第一次被写进日记。",
      "The day everything began.\nThis is where the echo first entered the journal.",
    ),
    imageSlot: chapterSceneOne,
    storyPath: "Chapter00_start",
  },
  {
    id: "CH-01",
    title: copy("遗落的线索", "Lost Clue"),
    order: "II",
    date: "326Y·7D·13R",
    textContent: copy(
      "我一开始就没打算从正门进。\n档案室里的缺失，比任何记录都更像证词。",
      "I never planned to enter through the front door.\nIn the archive, absence speaks louder than any record."
    ),
    imageSlot: chapterSceneTwo,
    storyPath: "Chapter0A_start",
  },
  {
    id: "CH-02",
    title: copy("失控的瞬间", "Moment of Losing Control"),
    order: "III",
    date: "326Y·7D·28R",
    textContent: copy(
      "纳斯卡边境的风声并不平静。\n有些失控并非突然发生，而是终于无法再被压住。",
      "The wind at the Nasca border is never still.\nSome loss of control does not happen suddenly; it simply can no longer be contained."
    ),
    imageSlot: chapterSceneThree,
    storyPath: "Chapter0B_start",
  }
];

const itemMemoryChapters: ChapterContent[] = [
  {
    id: "ITEM-MEM-01",
    title: copy("旧铜铃的回忆", "Memory of the Brass Bell"),
    order: "支 I",
    date: "侧录·01",
    textContent: copy(
      "这枚旧铜铃保存着一段尚未整理的支线回忆。\n之后可以替换为独立脚本、分支选择与解锁逻辑。",
      "This old brass bell holds a side memory not yet fully archived.\nIt can later be replaced with its own script, choices, and unlock logic.",
    ),
    imageSlot: chapterOnePageArt,
  },
  {
    id: "ITEM-MEM-02",
    title: copy("裂纹罗盘的回忆", "Memory of the Cracked Compass"),
    order: "支 II",
    date: "侧录·02",
    textContent: copy(
      "罗盘上的裂纹像一条被折断的路线。\n这里先作为物品支线剧情的第二个入口。",
      "The crack on the compass resembles a broken route.\nFor now, this is the second item-side-story entry.",
    ),
    imageSlot: chapterOnePageArt,
  },
  {
    id: "ITEM-MEM-03",
    title: copy("缝线布片的回忆", "Memory of the Stitched Cloth"),
    order: "支 III",
    date: "侧录·03",
    textContent: copy(
      "布片上残留的针脚很细，像是某个人一夜未眠留下的痕迹。\n这里先预留为支线回忆。",
      "The stitches on the cloth are fine, like traces left by someone who stayed awake all night.\nThis is reserved as a side memory.",
    ),
    imageSlot: chapterOnePageArt,
  },
  {
    id: "ITEM-MEM-04",
    title: copy("磨损骨扣的回忆", "Memory of the Worn Bone Clasp"),
    order: "支 IV",
    date: "侧录·04",
    textContent: copy(
      "骨扣的边缘被反复摩挲得发亮。\n它之后可以连接人物、线索或分支事件。",
      "The clasp's edge has been polished by repeated touch.\nLater, it can connect characters, clues, or branch events.",
    ),
    imageSlot: chapterOnePageArt,
  },
  {
    id: "ITEM-MEM-05",
    title: copy("干涸墨瓶的回忆", "Memory of the Dried Ink"),
    order: "支 V",
    date: "侧录·05",
    textContent: copy(
      "墨瓶已经干涸，但瓶口仍有暗色沉积。\n这里先建立第五个物品记忆入口。",
      "The ink bottle has dried, but dark residue remains around its mouth.\nThis establishes the fifth item memory entry.",
    ),
    imageSlot: chapterOnePageArt,
  },
  {
    id: "ITEM-MEM-06",
    title: copy("断齿钥匙的回忆", "Memory of the Broken Key"),
    order: "支 VI",
    date: "侧录·06",
    textContent: copy(
      "钥匙缺了一枚齿，却像仍然能打开某个迟迟没有命名的地方。\n这里先作为第六个支线入口。",
      "The key is missing a tooth, yet it still feels able to open some unnamed place.\nThis is the sixth side-story entry for now.",
    ),
    imageSlot: chapterOnePageArt,
  },
];

type ItemArchiveEntry = {
  id: string;
  title: LocalizedCopy;
  description: LocalizedCopy;
  memoryChapterId: string;
  mark: string;
};

const itemArchiveEntries: ItemArchiveEntry[] = [
  {
    id: "ITEM-01",
    title: copy("旧铜铃", "Brass Bell"),
    description: copy(
      "铃舌已经磨钝，轻轻一晃却仍有很低的回声，像从某段被压住的记忆里传来。",
      "Its clapper is worn dull, yet a low echo remains, as if coming from a memory pressed beneath the surface.",
    ),
    memoryChapterId: "ITEM-MEM-01",
    mark: "I",
  },
  {
    id: "ITEM-02",
    title: copy("裂纹罗盘", "Cracked Compass"),
    description: copy(
      "指针停在偏北一点的位置，盘面裂开后，方向反而像被固定得更坚决。",
      "Its needle rests slightly north; after the face cracked, its direction seems even more stubbornly fixed.",
    ),
    memoryChapterId: "ITEM-MEM-02",
    mark: "II",
  },
  {
    id: "ITEM-03",
    title: copy("缝线布片", "Stitched Cloth"),
    description: copy(
      "布片边缘有新旧不一的针脚，像一件被反复修补却始终不肯丢掉的东西。",
      "Its edge carries stitches from different times, like something repaired again and again but never discarded.",
    ),
    memoryChapterId: "ITEM-MEM-03",
    mark: "III",
  },
  {
    id: "ITEM-04",
    title: copy("磨损骨扣", "Worn Bone Clasp"),
    description: copy(
      "骨扣表面被手指磨出温润的光，背面刻着一段难以辨认的短划。",
      "The bone clasp has been polished warm by touch; on the back, a few short marks are almost illegible.",
    ),
    memoryChapterId: "ITEM-MEM-04",
    mark: "IV",
  },
  {
    id: "ITEM-05",
    title: copy("干涸墨瓶", "Dried Ink Bottle"),
    description: copy(
      "瓶底残留着干裂的墨块，靠近时有一点旧纸和烟灰混合的味道。",
      "Cracked ink remains at the bottom, carrying a faint smell of old paper mixed with ash.",
    ),
    memoryChapterId: "ITEM-MEM-05",
    mark: "V",
  },
  {
    id: "ITEM-06",
    title: copy("断齿钥匙", "Broken Key"),
    description: copy(
      "钥匙少了一枚齿，却被人保管得很仔细，像真正重要的并不是它打开的门。",
      "The key is missing a tooth, but it has been kept carefully, as if the door it opens was never the important part.",
    ),
    memoryChapterId: "ITEM-MEM-06",
    mark: "VI",
  },
];

type CodexCategoryId = "people" | "clues" | "items" | "races";

type CodexCategory = {
  id: CodexCategoryId;
  label: LocalizedCopy;
  total: number;
};

type CodexGridEntry = {
  id: string;
  category: CodexCategoryId;
  title: LocalizedCopy;
  unlocked: boolean;
  mark: string;
};

const codexCategories: CodexCategory[] = [
  { id: "people", label: copy("人物", "People"), total: 16 },
  { id: "clues", label: copy("线索", "Clues"), total: 24 },
  { id: "items", label: copy("物品", "Items"), total: 30 },
  { id: "races", label: copy("种族", "Races"), total: 20 },
];

const createCodexEntries = (
  category: CodexCategoryId,
  total: number,
  unlockedCount: number,
  zhPrefix: string,
  enPrefix: string,
) =>
  Array.from({ length: total }, (_, index): CodexGridEntry => {
    const order = index + 1;
    return {
      id: `${category}-${String(order).padStart(2, "0")}`,
      category,
      title: copy(`${zhPrefix} ${order}`, `${enPrefix} ${order}`),
      unlocked: order <= unlockedCount,
      mark: String(order).padStart(2, "0"),
    };
  });

const codexEntries: CodexGridEntry[] = [
  ...createCodexEntries("people", 16, 4, "人物", "Person"),
  ...createCodexEntries("clues", 24, 2, "线索", "Clue"),
  ...createCodexEntries("items", 30, 6, "物品", "Item"),
  ...createCodexEntries("races", 20, 1, "种族", "Race"),
];

type MapRegion = {
  id: string;
  name: string;
  points: string;
  labelX: number;
  labelY: number;
};

const mapRegions: MapRegion[] = [
  {
    id: "ophield",
    name: "奥菲尔德",
    points: "95,168 178,112 276,132 330,208 292,284 174,304 102,252",
    labelX: 205,
    labelY: 210,
  },
  {
    id: "elvenda",
    name: "埃尔文达",
    points: "356,126 474,86 590,134 604,242 515,302 396,274 334,202",
    labelX: 472,
    labelY: 190,
  },
  {
    id: "sta",
    name: "斯塔",
    points: "646,160 760,112 858,170 826,294 706,326 626,254",
    labelX: 742,
    labelY: 222,
  },
  {
    id: "berndai",
    name: "伯恩代",
    points: "150,350 264,324 368,382 342,496 212,520 112,448",
    labelX: 242,
    labelY: 420,
  },
  {
    id: "yiyun",
    name: "依云",
    points: "430,350 548,314 668,374 640,506 502,534 390,466",
    labelX: 526,
    labelY: 426,
  },
  {
    id: "haier",
    name: "骸尔",
    points: "724,384 846,338 938,424 896,552 764,576 684,484",
    labelX: 808,
    labelY: 466,
  },
  {
    id: "nazca",
    name: "纳斯卡",
    points: "388,572 532,548 656,616 612,720 454,748 338,668",
    labelX: 502,
    labelY: 646,
  },
];

/**
 * DesktopContainer Component
 * A full-screen container simulating an ancient desk surface with 3D depth and side lighting.
 */
const DesktopContainer = ({
  children,
  className = "desk-surface-asset",
  contentClassName = "px-4 pb-28 pt-20 sm:px-6 sm:pb-32 sm:pt-24 lg:px-12 lg:pb-36 lg:pt-28 xl:px-16 xl:pb-28 xl:pt-24",
  showFlame = true,
  style,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  showFlame?: boolean;
  style?: CSSProperties;
}) => {
  return (
    <div className={`relative h-full w-full overflow-hidden select-none ${className}`} style={style}>
      {/* Main Table Content */}
      <div className={`relative z-10 flex h-full w-full items-stretch justify-center ${contentClassName}`}>
        {children}
      </div>

      {/* Static "World" Elements */}
      {showFlame && (
        <div className="absolute top-6 right-4 opacity-40 group pointer-events-none sm:top-8 sm:right-6 lg:top-12 lg:right-12">
          <Flame className="w-8 h-8 text-arch-accent/40" />
        </div>
      )}
    </div>
  );
};

/**
 * FocusArea Component
 * A central area on the desk for placing primary objects (diaries, maps, etc).
 */
const FocusArea = ({
  children,
  className = "",
  showShadow = true,
}: {
  children: ReactNode;
  className?: string;
  showShadow?: boolean;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={PAGE_FADE_TRANSITION}
      className={`relative flex h-full min-h-0 w-full max-w-[min(96vw,1500px)] items-center justify-center ${className}`}
    >
      {/* A subtle drop shadow for whatever sits in the focus area */}
      {showShadow && (
        <div className="pointer-events-none absolute inset-x-8 -bottom-12 hidden h-24 rounded-[100%] bg-black/40 blur-[60px] lg:block" />
      )}
      {children}
    </motion.div>
  );
};

/**
 * ChapterList Component
 * A stylized directory with rune decorations and fade+scale transitions.
 */
const ChapterList = ({
  chapters,
  onSelect,
  activeChapter,
  language,
  title,
}: {
  chapters: ChapterContent[];
  onSelect: (chapter: ChapterContent) => void;
  activeChapter: ChapterContent;
  language: Language;
  title: string;
}) => {
  return (
    <div className="w-full max-w-md space-y-5">
      <div className="flex items-center gap-4 text-arch-accent/40 mb-8">
        <Sparkles className="w-4 h-4" />
        <span className="afterland-meta whitespace-nowrap uppercase font-display">{title}</span>
        <div className="h-px flex-1 bg-current" />
      </div>
      <div className="space-y-4">
        {chapters.map((chapter, index: number) => (
          <motion.button
            key={chapter.id}
            onClick={() => onSelect(chapter)}
            whileHover={{ x: 10, opacity: 1 }}
            className={`flex w-full items-center gap-3 text-left group transition-all duration-700 sm:gap-4 ${
              activeChapter?.id === chapter.id ? "opacity-100" : "opacity-40"
            }`}
          >
            <span className="shrink-0 font-display text-[11px] text-arch-accent/60 group-hover:text-arch-accent sm:text-xs">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex flex-col gap-1">
              <span className="afterland-copy text-[1.05rem] leading-snug font-chinese tracking-[0.08em] text-arch-paper/90 transition-colors group-hover:text-arch-paper sm:text-[1.12rem] xl:text-[1.2rem]">
                {chapter.title[language]}
              </span>
              <span className="afterland-meta uppercase text-arch-accent/40 group-hover:text-arch-accent/80">
                {chapter.id}
              </span>
            </div>
            {activeChapter?.id === chapter.id && (
              <motion.div
                layoutId="rune-active"
                className="ml-auto h-2 w-2 shrink-0 rounded-full bg-arch-accent shadow-[0_0_10px_var(--color-arch-accent)]"
              />
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
};

/**
 * DiaryBook Component
 * Simulates a physical book with a page flip effect and yellowed paper texture.
 */
const DiaryBook = ({ currentPage, totalPages, onNext, onPrev, content }: any) => {
  const [isFlipping, setIsFlipping] = useState(false);
  const [direction, setDirection] = useState(1); // 1 for forward, -1 for backward

  const handleNext = () => {
    if (isFlipping) return;
    setDirection(1);
    setIsFlipping(true);
    setTimeout(onNext, 400); // Sync content change with mid-flip
  };

  const handlePrev = () => {
    if (isFlipping) return;
    setDirection(-1);
    setIsFlipping(true);
    setTimeout(onPrev, 400);
  };

  const flipTransition = {
    type: "spring",
    stiffness: 40,
    damping: 18,
    mass: 1.2
  };

  return (
    <div className="relative flex h-[clamp(34rem,72vh,38rem)] w-full max-w-4xl items-center justify-center perspective-[2000px]">
      {/* Book Cover / Shadow */}
      <div className="absolute inset-x-0 -inset-y-4 bg-[#2a1a0f] rounded-lg shadow-2xl skew-x-[-1deg] rotate-[-1deg]" />
      <div className="absolute inset-0 bg-[#3d2b1e] rounded shadow-inner" />

      {/* Pages Container */}
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded diary-paper shadow-[inset_0_0_100px_rgba(0,0,0,0.5)] lg:flex-row">
        {/* Binding Line */}
        <div className="absolute left-6 right-6 top-1/2 z-30 h-px bg-black/15 lg:bottom-6 lg:left-1/2 lg:right-auto lg:top-6 lg:h-auto lg:w-px" />
        
        {/* Left Page (Static) */}
        <div className="relative z-10 flex flex-1 flex-col justify-between bg-[#f4efdf] p-6 sm:p-8 lg:pr-12 lg:pl-10 xl:pr-16">
          <div className="space-y-6 sm:space-y-8">
            <div className="flex justify-between items-start">
              <span className="font-display text-lg tracking-[0.24em] text-arch-ink/40 sm:text-xl">{content.order}</span>
              <span className="afterland-meta whitespace-nowrap text-arch-ink/30">{content.date}</span>
            </div>
            <div className="space-y-6" lang="zh-CN">
              <h2 className="afterland-title mb-6 font-chinese font-bold text-diary-ink drop-shadow-sm">
                {content.title}
              </h2>
              <div className="afterland-copy afterland-body border-l-2 border-arch-accent/10 py-2 pl-5 font-chinese italic whitespace-pre-line text-diary-ink/90 sm:pl-6">
                {content.textContent}
              </div>
            </div>
          </div>
          
          <button 
            onClick={handlePrev}
            className="group afterland-meta flex items-center gap-2 whitespace-nowrap uppercase font-display text-arch-accent/60 transition-all hover:translate-x-[-4px] hover:text-arch-accent"
          >
            <BackIcon className="text-arch-accent/60 group-hover:text-arch-accent" />
            <span>上一章</span>
          </button>
        </div>

        {/* Right Page (Static) */}
        <div className="relative z-10 flex flex-1 flex-col justify-between bg-[#ede8d5] p-6 sm:p-8 lg:pl-12 lg:pr-10 xl:pl-16">
           <div className="flex-1 flex items-center justify-center">
            {content.imageSlot ? (
              <div className="relative w-full aspect-[4/5] arch-border rounded-sm overflow-hidden group shadow-arch-flat">
                <img 
                  src={content.imageSlot} 
                  alt="Page Illustration" 
                  className="w-full h-full object-cover grayscale sepia-[.4] opacity-70 group-hover:opacity-100 transition-opacity duration-1000"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 noise blend-overlay opacity-30" />
                <div className="afterland-meta absolute bottom-4 left-4 right-4 bg-black/20 py-1 text-center uppercase font-display text-white/50 backdrop-blur-sm">
                  [ 项目重建：区域 {content.id} ]
                </div>
              </div>
            ) : (
              <div className="afterland-copy flex w-full aspect-[4/5] items-center justify-center border border-dashed border-arch-accent/20 bg-arch-ink/5 px-12 text-center text-sm italic text-arch-ink/30">
                "此处本应绘有一幅画作，但记忆的像素已在地层中消磨殆尽。"
              </div>
            )}
          </div>
          
          <button 
            onClick={handleNext}
            className="afterland-meta whitespace-nowrap uppercase font-display text-arch-accent/60 transition-all hover:translate-x-[4px] hover:text-arch-accent"
          >
            下一章 →
          </button>
        </div>

        {/* Flip Overlay (Simulating 3D page flip) */}
        <AnimatePresence>
          {isFlipping && (
             <motion.div
              key="page-flip"
              initial={{ rotateY: 0 }}
              animate={{ rotateY: direction > 0 ? -180 : 180 }}
              exit={{ opacity: 0 }}
              onAnimationComplete={() => setIsFlipping(false)}
              transition={flipTransition}
              style={{ transformOrigin: direction > 0 ? "left center" : "right center", left: direction > 0 ? "50%" : "0" }}
              className={`absolute top-0 w-1/2 h-full diary-paper border-black/10 z-40 shadow-2xl pointer-events-none ${direction > 0 ? "border-l" : "border-r"}`}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Page Tabs */}
      <div className="absolute left-[-48px] top-12 hidden space-y-4 xl:block">
        {["日记", "朋友", "信物"].map((tab) => (
          <motion.button
            key={tab}
            whileHover={{ x: 5 }}
            className={`afterland-meta writing-vertical rounded-l-lg border border-arch-paper/10 bg-arch-bg/60 px-4 py-6 uppercase font-display backdrop-blur-md transition-colors ${
              tab === "日记" ? "text-arch-accent bg-arch-accent/10 border-arch-accent/40" : "text-arch-paper/40 hover:bg-arch-paper/5"
            }`}
            style={{ writingMode: 'vertical-rl' }}
          >
            {tab}
          </motion.button>
        ))}
      </div>
    </div>
  );
};
const ArcheoPaper = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <motion.div
    initial={{ scale: 0.95, opacity: 0, rotateX: 10 }}
    animate={{ scale: 1, opacity: 1, rotateX: 0 }}
    transition={{ type: "spring", stiffness: 50, damping: 20 }}
    className={`paper-texture bg-arch-bg/40 backdrop-blur-xl arch-border p-8 rounded-sm shadow-arch-heavy ${className}`}
  >
    <div className="relative z-10">{children}</div>
    {/* Decorative corner elements */}
    <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-arch-accent/40" />
    <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-arch-accent/40" />
    <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-arch-accent/40" />
    <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-arch-accent/40" />
  </motion.div>
);

const NavItem = ({ icon: Icon, label, active, onClick }: any) => (
  <motion.button
    whileHover={{ x: 5 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className={`flex min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors duration-500 group sm:px-5 sm:py-4 ${
      active ? "bg-arch-accent/10 border-l-2 border-arch-accent" : "hover:bg-arch-paper/5"
    }`}
  >
    <Icon className={`h-5 w-5 shrink-0 ${active ? "text-arch-accent" : "text-arch-paper/40 group-hover:text-arch-paper"}`} />
    <span className={`afterland-label whitespace-nowrap text-[11px] uppercase font-display sm:text-xs ${active ? "text-arch-paper" : "text-arch-paper/30 group-hover:text-arch-paper"}`}>
      {label}
    </span>
  </motion.button>
);

const LandingBackdrop = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#0f0906]">
    <video
      className="absolute inset-0 h-full w-full object-cover object-center"
      src={`${import.meta.env.BASE_URL}landing-loop.mp4`}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
    />
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_74%_16%,rgba(255,210,132,0.16),transparent_12%),linear-gradient(to_bottom,rgba(10,5,2,0.42),rgba(10,5,2,0.08)_32%,rgba(10,5,2,0.46))]" />
  </div>
);

const LandingMenuButton = ({
  label,
  onClick,
  delay,
}: {
  label: string;
  onClick: () => void;
  delay: number;
}) => (
  <motion.button
    type="button"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay, duration: 0.55, ease: "easeOut" }}
    whileHover={{ x: 6 }}
    whileTap={{ scale: 0.985 }}
    onClick={onClick}
    className="group relative flex items-center bg-transparent px-2 py-1"
  >
    <span className="font-chinese text-[clamp(1rem,0.92rem+0.48vw,1.55rem)] tracking-[0.08em] text-[#ead5b5] drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] transition-all duration-300 group-hover:text-[#fff0d6] group-hover:drop-shadow-[0_0_16px_rgba(255,221,176,0.45)]">
      {label}
    </span>
  </motion.button>
);

const SettingsSwitch = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative h-[2rem] w-[3.8rem] shrink-0 rounded-full transition-colors duration-300 ${
      checked
        ? "bg-[#de9f42]"
        : "bg-[#b1b1b1]"
    }`}
  >
    <span
      className={`absolute left-0 top-1/2 h-[1.68rem] w-[1.68rem] -translate-y-1/2 rounded-full bg-[#f8f8f8] transition-transform duration-300 ${
        checked ? "translate-x-[1.96rem]" : "translate-x-[0.16rem]"
      }`}
    />
  </button>
);

const SettingsPanel = ({
  open,
  onClose,
  language,
  setLanguage,
  bodyTextSize,
  setBodyTextSize,
  musicEnabled,
  setMusicEnabled,
  musicVolume,
  setMusicVolume,
  sfxEnabled,
  setSfxEnabled,
  autoPlayEnabled,
  setAutoPlayEnabled,
  autoPlaySpeed,
  setAutoPlaySpeed,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  language: Language;
  setLanguage: (language: Language) => void;
  bodyTextSize: BodyTextSize;
  setBodyTextSize: (size: BodyTextSize) => void;
  musicEnabled: boolean;
  setMusicEnabled: (enabled: boolean) => void;
  musicVolume: number;
  setMusicVolume: (value: number) => void;
  sfxEnabled: boolean;
  setSfxEnabled: (enabled: boolean) => void;
  autoPlayEnabled: boolean;
  setAutoPlayEnabled: (enabled: boolean) => void;
  autoPlaySpeed: number;
  setAutoPlaySpeed: (value: number) => void;
  ui: {
    title: string;
    close: string;
    language: string;
    bodyTextSize: string;
    autoPlay: string;
    autoPlaySpeed: string;
    music: string;
    musicVolume: string;
    soundEffects: string;
    on: string;
    off: string;
    chinese: string;
    english: string;
    small: string;
    medium: string;
    large: string;
  };
}) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[90] bg-black/18 backdrop-blur-[2px]"
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25 }}
          className="fixed right-4 top-20 z-[100] w-[min(24rem,calc(100vw-2rem))] min-w-[18rem] rounded-[1.4rem] border border-[#d5b48a]/18 bg-[rgba(26,13,7,0.78)] p-5 text-[#f2dfc3] shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:right-6 sm:top-24 sm:w-[24rem] sm:p-6 lg:right-8"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-chinese text-[1.25rem] tracking-[0.12em] text-[#f3dec1]">
              {ui.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="font-chinese text-sm tracking-[0.12em] text-[#e8cfaa]/70 transition-colors hover:text-[#fff0d4]"
            >
              {ui.close}
            </button>
          </div>

          <div className="mt-6 space-y-5">
            <div>
              <p className="font-chinese text-sm tracking-[0.12em] text-[#e8cfaa]/76">
                {ui.language}
              </p>
              <div className="mt-3 flex gap-3">
                {([
                  { value: "zh", label: ui.chinese },
                  { value: "en", label: ui.english },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setLanguage(option.value)}
                    className={`rounded-full border px-4 py-2 font-chinese text-sm tracking-[0.08em] transition-all ${
                      language === option.value
                        ? "border-[#f0d6af]/50 bg-[#f0d6af]/12 text-[#fff2de]"
                        : "border-[#f0d6af]/16 bg-black/10 text-[#e6cfaf]/72 hover:border-[#f0d6af]/34 hover:text-[#fff0d4]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="font-chinese text-sm tracking-[0.12em] text-[#e8cfaa]/76">
                {ui.bodyTextSize}
              </p>
              <div className="mt-3 flex gap-3">
                {([
                  { value: "small", label: ui.small },
                  { value: "medium", label: ui.medium },
                  { value: "large", label: ui.large },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setBodyTextSize(option.value)}
                    className={`rounded-full border px-4 py-2 font-chinese text-sm tracking-[0.08em] transition-all ${
                      bodyTextSize === option.value
                        ? "border-[#f0d6af]/50 bg-[#f0d6af]/12 text-[#fff2de]"
                        : "border-[#f0d6af]/16 bg-black/10 text-[#e6cfaf]/72 hover:border-[#f0d6af]/34 hover:text-[#fff0d4]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-4">
                <p className="font-chinese text-sm tracking-[0.12em] text-[#e8cfaa]/76">
                  {ui.autoPlay}
                </p>
                <SettingsSwitch checked={autoPlayEnabled} onChange={setAutoPlayEnabled} label={ui.autoPlay} />
              </div>
              {autoPlayEnabled && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-chinese text-xs tracking-[0.12em] text-[#e8cfaa]/56">
                      {ui.autoPlaySpeed}
                    </span>
                    <span className="font-display text-sm tracking-[0.12em] text-[#fff0d4]/82">
                      {autoPlaySpeed}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={autoPlaySpeed}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setAutoPlaySpeed(Number(event.target.value))}
                    className="mt-2 h-2 w-full cursor-pointer accent-[#e0be8f]"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between gap-4">
                <p className="font-chinese text-sm tracking-[0.12em] text-[#e8cfaa]/76">
                  {ui.music}
                </p>
                <SettingsSwitch checked={musicEnabled} onChange={setMusicEnabled} label={ui.music} />
              </div>
              {musicEnabled && (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-chinese text-xs tracking-[0.12em] text-[#e8cfaa]/56">
                      {ui.musicVolume}
                    </span>
                    <span className="font-display text-sm tracking-[0.12em] text-[#fff0d4]/82">
                      {musicVolume}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={musicVolume}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setMusicVolume(Number(event.target.value))}
                    className="mt-2 h-2 w-full cursor-pointer accent-[#e0be8f]"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="font-chinese text-sm tracking-[0.12em] text-[#e8cfaa]/76">
                {ui.soundEffects}
              </p>
              <SettingsSwitch checked={sfxEnabled} onChange={setSfxEnabled} label={ui.soundEffects} />
            </div>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

const SaveSlotsPanel = ({
  open,
  onClose,
  onLoad,
  slots,
  language,
  ui,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (slotId: string) => void;
  slots: PlaythroughSaveSlot[];
  language: Language;
  ui: (typeof UI_COPY)[Language]["saves"];
}) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[92] bg-black/32 backdrop-blur-[3px]"
        />
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="fixed left-1/2 top-1/2 z-[102] w-[min(43rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-[1.45rem] border border-[#d5b48a]/18 bg-[rgba(23,12,7,0.84)] p-6 text-[#f2dfc3] shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-5">
            <div>
              <h2 className="font-chinese text-[1.45rem] tracking-[0.14em] text-[#f3dec1]">
                {ui.title}
              </h2>
              <p className="mt-2 font-chinese text-sm leading-relaxed tracking-[0.08em] text-[#e6cfaf]/62">
                {ui.overwriteHint}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="font-chinese text-sm tracking-[0.12em] text-[#e8cfaa]/70 transition-colors hover:text-[#fff0d4]"
            >
              {UI_COPY[language].landing.close}
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {Array.from({ length: MAX_PLAYTHROUGH_SAVE_SLOTS }).map((_, index) => {
              const slot = slots[index];
              const state = slot ? readGameSaveStateFromStorage(slot.storage) : null;
              const chapter = state ? chapters.find((item) => item.id === state.activeChapterId) : null;
              const completedCount = slot ? getSaveSlotCompletedCount(slot) : 0;

              return (
                <button
                  key={slot?.id ?? `empty-${index}`}
                  type="button"
                  disabled={!slot}
                  onClick={() => {
                    if (slot) onLoad(slot.id);
                  }}
                  className={`group min-h-[7.4rem] rounded-[1rem] border p-4 text-left transition-all ${
                    slot
                      ? "border-[#d8b889]/22 bg-[#f1d5aa]/8 hover:border-[#f1d5aa]/45 hover:bg-[#f1d5aa]/12"
                      : "cursor-default border-[#d8b889]/10 bg-black/10 opacity-54"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-chinese text-sm tracking-[0.14em] text-[#fff0d8]/78">
                      {ui.slotLabel} {String(index + 1).padStart(2, "0")}
                    </span>
                    {slot ? (
                      <span className="font-chinese text-xs tracking-[0.1em] text-[#e8cfaa]/54">
                        {formatSaveSlotTimestamp(slot.savedAt, language)}
                      </span>
                    ) : null}
                  </div>

                  {slot && state && chapter ? (
                    <>
                      <p className="mt-4 font-chinese text-[1.04rem] tracking-[0.08em] text-[#f7dfbd]">
                        {chapter.title[language]}
                      </p>
                      <p className="mt-2 font-chinese text-xs leading-relaxed tracking-[0.08em] text-[#e5caa4]/62">
                        {state.view === "detailed" ? ui.currentChapter : UI_COPY[language].home.hub} · {ui.load}
                        {completedCount > 0 ? ` · ${completedCount}/${chapters.length}` : ""}
                      </p>
                    </>
                  ) : (
                    <p className="mt-5 font-chinese text-[1.02rem] tracking-[0.12em] text-[#e6cfaf]/44">
                      {ui.emptySlot}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {slots.length === 0 ? (
            <p className="mt-4 text-center font-chinese text-sm tracking-[0.08em] text-[#e6cfaf]/50">
              {ui.noSaves}
            </p>
          ) : null}
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

const NewGamePrompt = ({
  open,
  onSaveAndStart,
  onStartWithoutSave,
  onCancel,
  ui,
}: {
  open: boolean;
  onSaveAndStart: () => void;
  onStartWithoutSave: () => void;
  onCancel: () => void;
  ui: (typeof UI_COPY)[Language]["saves"];
}) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
          className="fixed inset-0 z-[94] bg-black/38 backdrop-blur-[3px]"
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.26 }}
          className="fixed left-1/2 top-1/2 z-[104] w-[min(34rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-[1.35rem] border border-[#d5b48a]/18 bg-[rgba(24,12,7,0.88)] p-6 text-[#f2dfc3] shadow-[0_22px_70px_rgba(0,0,0,0.52)] backdrop-blur-xl"
        >
          <h2 className="font-chinese text-[1.35rem] tracking-[0.14em] text-[#f3dec1]">
            {ui.newGameTitle}
          </h2>
          <p className="mt-4 font-chinese text-sm leading-[1.8] tracking-[0.08em] text-[#e6cfaf]/72">
            {ui.newGameBody}
          </p>
          <p className="mt-2 font-chinese text-xs leading-relaxed tracking-[0.08em] text-[#e6cfaf]/45">
            {ui.overwriteHint}
          </p>

          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-[#f0d6af]/14 bg-black/12 px-4 py-2 font-chinese text-sm tracking-[0.1em] text-[#e6cfaf]/70 transition-colors hover:border-[#f0d6af]/32 hover:text-[#fff0d4]"
            >
              {ui.cancel}
            </button>
            <button
              type="button"
              onClick={onStartWithoutSave}
              className="rounded-full border border-[#f0d6af]/18 bg-[#f0d6af]/6 px-4 py-2 font-chinese text-sm tracking-[0.1em] text-[#e6cfaf]/82 transition-colors hover:border-[#f0d6af]/38 hover:text-[#fff0d4]"
            >
              {ui.startWithoutSave}
            </button>
            <button
              type="button"
              onClick={onSaveAndStart}
              className="rounded-full border border-[#f0d6af]/42 bg-[#f0d6af]/14 px-4 py-2 font-chinese text-sm tracking-[0.1em] text-[#fff1dd] transition-colors hover:border-[#ffe0b2]/66 hover:bg-[#f0d6af]/18"
            >
              {ui.saveAndStart}
            </button>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

const BackIcon = ({ className = "" }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={`inline-flex shrink-0 text-[#ebd4af]/92 transition-[color,transform] group-hover:text-[#fff0d8] ${className}`}
  >
    ←
  </span>
);

const PAGE_FADE_TRANSITION = {
  duration: 0.45,
  ease: "easeInOut" as const,
};

const MIN_STAGE_WIDTH = 1527;
const MIN_STAGE_HEIGHT = 859;

const CornerActionButton = ({
  label,
  onClick,
  className = "",
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`group flex items-center gap-2 whitespace-nowrap bg-transparent px-1 py-1 font-chinese text-[1rem] tracking-[0.12em] text-[#f2dfc3] drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] transition-all hover:text-[#fff0d8] hover:drop-shadow-[0_0_18px_rgba(255,220,170,0.55)] sm:text-[1.06rem] ${className}`}
  >
    <BackIcon />
    <span>{label}</span>
  </button>
);

const GlobalSettingsControl = ({
  open,
  onOpen,
  onClose,
  language,
  setLanguage,
  bodyTextSize,
  setBodyTextSize,
  musicEnabled,
  setMusicEnabled,
  musicVolume,
  setMusicVolume,
  sfxEnabled,
  setSfxEnabled,
  autoPlayEnabled,
  setAutoPlayEnabled,
  autoPlaySpeed,
  setAutoPlaySpeed,
  ui,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  language: Language;
  setLanguage: (language: Language) => void;
  bodyTextSize: BodyTextSize;
  setBodyTextSize: (size: BodyTextSize) => void;
  musicEnabled: boolean;
  setMusicEnabled: (enabled: boolean) => void;
  musicVolume: number;
  setMusicVolume: (value: number) => void;
  sfxEnabled: boolean;
  setSfxEnabled: (enabled: boolean) => void;
  autoPlayEnabled: boolean;
  setAutoPlayEnabled: (enabled: boolean) => void;
  autoPlaySpeed: number;
  setAutoPlaySpeed: (value: number) => void;
  ui: (typeof UI_COPY)[Language];
}) => (
  <>
    <div className="fixed right-4 top-4 z-[110] sm:right-6 sm:top-6 lg:right-8 lg:top-8">
      <button
        type="button"
        onClick={open ? onClose : onOpen}
        className={`group flex items-center gap-2 whitespace-nowrap bg-transparent px-1 py-1 font-chinese text-[1rem] tracking-[0.12em] text-[#f2dfc3] drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] transition-all hover:text-[#fff0d8] hover:drop-shadow-[0_0_18px_rgba(255,220,170,0.55)] sm:text-[1.06rem] ${
          open ? "text-[#fff0d8] drop-shadow-[0_0_18px_rgba(255,220,170,0.55)]" : ""
        }`}
      >
        <Settings2 className="h-4 w-4 text-[#ebd4af]/92 transition-colors group-hover:text-[#fff0d8]" />
        <span>{ui.settings.title}</span>
      </button>
    </div>

    <SettingsPanel
      open={open}
      onClose={onClose}
      language={language}
      setLanguage={setLanguage}
      bodyTextSize={bodyTextSize}
      setBodyTextSize={setBodyTextSize}
      musicEnabled={musicEnabled}
      setMusicEnabled={setMusicEnabled}
      musicVolume={musicVolume}
      setMusicVolume={setMusicVolume}
      sfxEnabled={sfxEnabled}
      setSfxEnabled={setSfxEnabled}
      autoPlayEnabled={autoPlayEnabled}
      setAutoPlayEnabled={setAutoPlayEnabled}
      autoPlaySpeed={autoPlaySpeed}
      setAutoPlaySpeed={setAutoPlaySpeed}
      ui={{
        title: ui.settings.title,
        close: ui.landing.close,
        language: ui.settings.language,
        bodyTextSize: ui.settings.bodyTextSize,
        autoPlay: ui.settings.autoPlay,
        autoPlaySpeed: ui.settings.autoPlaySpeed,
        music: ui.settings.music,
        musicVolume: ui.settings.musicVolume,
        soundEffects: ui.settings.soundEffects,
        on: ui.settings.on,
        off: ui.settings.off,
        chinese: ui.settings.chinese,
        english: ui.settings.english,
        small: ui.settings.small,
        medium: ui.settings.medium,
        large: ui.settings.large,
      }}
    />
  </>
);

const HomeHotspot = ({
  label,
  className,
  onClick,
  style,
  disabled = false,
}: {
  label: string;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
  disabled?: boolean;
}) => {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { scale: 1.04, y: -3 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      onClick={onClick}
      style={style}
      className={`group absolute flex items-center justify-center bg-transparent px-4 py-3 text-center ${disabled ? "cursor-default" : "cursor-pointer"} ${className ?? ""}`}
    >
      <span className="pointer-events-none absolute inset-0 rounded-full bg-black/10 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
      <span
        className={`relative font-chinese text-[clamp(1.15rem,0.95rem+0.85vw,2rem)] tracking-[0.18em] text-[#f2e5cb] drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)] transition-all duration-300 ${
          disabled ? "opacity-75" : "group-hover:text-[#fff4df] group-hover:drop-shadow-[0_0_16px_rgba(255,219,160,0.6)]"
        }`}
      >
        {label}
      </span>
    </motion.button>
  );
};

/**
 * HomeView Component
 * An immersive "Hub" menu strongly referencing the uploaded image.
 */
const HomeView = ({
  onNavigate,
  onBackToLanding,
  journalLabel,
  itemLabel,
  codexLabel,
  mapLabel,
  backLabel,
}: {
  onNavigate: (dest: DesktopPanelId) => void;
  onBackToLanding: () => void;
  journalLabel: string;
  itemLabel: string;
  codexLabel: string;
  mapLabel: string;
  backLabel: string;
}) => {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#120905]">
      <div
        className="absolute inset-0 scale-105 bg-cover bg-center opacity-35 blur-[18px]"
        style={{ backgroundImage: `url(${homeHubImage})` }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_12%,rgba(111,66,34,0.25),transparent_44%),linear-gradient(to_bottom,rgba(9,4,2,0.6),rgba(9,4,2,0.16)_30%,rgba(9,4,2,0.6))]" />

      <div
        className="relative z-10 overflow-hidden"
        style={{
          width: `max(max(100vw, ${MIN_STAGE_WIDTH}px), calc(max(100vh, ${MIN_STAGE_HEIGHT}px) * 2048 / 1180))`,
          height: `max(max(100vh, ${MIN_STAGE_HEIGHT}px), calc(max(100vw, ${MIN_STAGE_WIDTH}px) * 1180 / 2048))`,
        }}
      >
        <img
          src={homeHubImage}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center select-none"
          draggable={false}
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(8,4,2,0.3),rgba(8,4,2,0.04)_36%,rgba(8,4,2,0.22)_100%)]" />

        <HomeHotspot
          label={journalLabel}
          onClick={() => onNavigate("artifacts")}
          className="left-[31.2%] top-[51%] min-w-[8rem] -translate-x-1/2 -translate-y-1/2"
          style={{ marginLeft: "28pt" }}
        />
        <HomeHotspot
          label={itemLabel}
          onClick={() => onNavigate("items")}
          className="left-[74.8%] top-[69.4%] min-w-[7rem] -translate-x-1/2 -translate-y-1/2"
        />
        <HomeHotspot
          label={codexLabel}
          onClick={() => onNavigate("codex")}
          className="left-[49.8%] top-[17.8%] min-w-[7rem] -translate-x-1/2 -translate-y-1/2"
        />
        <HomeHotspot
          label={mapLabel}
          onClick={() => onNavigate("map")}
          className="left-[66.2%] top-[43.5%] min-w-[7rem] -translate-x-1/2 -translate-y-1/2"
        />
      </div>

      <div className="absolute left-4 top-4 z-40 sm:left-6 sm:top-6 lg:left-8 lg:top-8">
        <CornerActionButton label={backLabel} onClick={onBackToLanding} />
      </div>
    </div>
  );
};

type DesktopQuickMenuItem = {
  id: DesktopPanelId;
  label: LocalizedCopy;
  iconSrc: string;
  iconAngle: number;
  labelAngle: number;
};

const DESKTOP_QUICK_MENU_VISIBLE_ANGLE = 225;
const DESKTOP_QUICK_MENU_SIZE = "clamp(16rem, 20vw, 20.5rem)";
const DESKTOP_QUICK_MENU_DIAL_SIZE = "80%";
const DESKTOP_QUICK_MENU_ICON_RING_SIZE = "clamp(9.2rem, 11.6vw, 11.6rem)";
const DESKTOP_QUICK_MENU_ICON_RADIUS = "clamp(3.72rem, 4.65vw, 4.85rem)";
const DESKTOP_QUICK_MENU_LABEL_RADIUS = "clamp(9.25rem, 11.65vw, 11rem)";

const DESKTOP_QUICK_MENU_ITEMS: DesktopQuickMenuItem[] = [
  {
    id: "artifacts",
    label: copy("手札", "Handbook"),
    iconSrc: quickMenuIconHandbook,
    iconAngle: 225,
    labelAngle: 252,
  },
  {
    id: "items",
    label: copy("物品", "Items"),
    iconSrc: quickMenuIconItems,
    iconAngle: 315,
    labelAngle: 235,
  },
  {
    id: "codex",
    label: copy("图鉴", "Codex"),
    iconSrc: quickMenuIconCodex,
    iconAngle: 45,
    labelAngle: 218,
  },
  {
    id: "map",
    label: copy("地图", "Map"),
    iconSrc: quickMenuIconMap,
    iconAngle: 135,
    labelAngle: 201,
  },
];

const DesktopQuickMenu = ({
  activeTab,
  onSelect,
  language,
  disabled = false,
  onLockedSelect,
}: {
  activeTab: DesktopPanelId;
  onSelect: (panel: DesktopPanelId) => void;
  language: Language;
  disabled?: boolean;
  onLockedSelect?: () => void;
}) => {
  const activeItem = DESKTOP_QUICK_MENU_ITEMS.find((item) => item.id === activeTab) ?? DESKTOP_QUICK_MENU_ITEMS[0];
  const ringRotation = DESKTOP_QUICK_MENU_VISIBLE_ANGLE - activeItem.iconAngle;

  return (
    <div
      className="pointer-events-none absolute bottom-0 right-0 z-[70] overflow-hidden"
      style={{ height: DESKTOP_QUICK_MENU_SIZE, width: DESKTOP_QUICK_MENU_SIZE }}
    >
      <img
        src={quickMenuDial}
        alt=""
        className="pointer-events-none absolute bottom-0 right-0 object-contain object-right-bottom"
        style={{ height: DESKTOP_QUICK_MENU_DIAL_SIZE, width: DESKTOP_QUICK_MENU_DIAL_SIZE }}
        aria-hidden="true"
      />

      {DESKTOP_QUICK_MENU_ITEMS.map((item) => {
        const active = item.id === activeTab;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (disabled) {
                onLockedSelect?.();
                return;
              }
              onSelect(item.id);
            }}
            className={`pointer-events-auto absolute w-[5.8rem] whitespace-nowrap bg-transparent px-2 py-1 text-center font-chinese text-[clamp(0.98rem,0.85rem+0.24vw,1.24rem)] tracking-[0.14em] drop-shadow-[0_2px_9px_rgba(0,0,0,0.72)] transition-all ${
              active
                ? "text-[#f5dfbf] opacity-100"
                : disabled
                  ? "text-[#e8d2b4]/56"
                  : "text-[#e8d2b4]/72 hover:text-[#fff1d4] hover:opacity-100"
            }`}
            style={{
              left: "100%",
              top: "100%",
              transform: `translate(-50%, -50%) rotate(${item.labelAngle}deg) translate(${DESKTOP_QUICK_MENU_LABEL_RADIUS}) rotate(${-item.labelAngle}deg)`,
            }}
          >
            {item.label[language]}
          </button>
        );
      })}

      <div
        className="absolute left-full top-full"
        style={{
          height: DESKTOP_QUICK_MENU_ICON_RING_SIZE,
          width: DESKTOP_QUICK_MENU_ICON_RING_SIZE,
          transform: "translate(-50%, -50%)",
        }}
      >
        <motion.div
          className="relative h-full w-full"
          animate={{ rotate: ringRotation }}
          transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
        >
          {DESKTOP_QUICK_MENU_ITEMS.map((item) => {
            const active = item.id === activeTab;
            return (
              <button
                key={`icon-${item.id}`}
                type="button"
                onClick={() => {
                  if (disabled) {
                    onLockedSelect?.();
                    return;
                  }
                  onSelect(item.id);
                }}
                className={`pointer-events-auto absolute left-1/2 top-1/2 flex h-[3.85rem] w-[3.85rem] items-center justify-center rounded-full bg-transparent transition-opacity ${
                  active ? "opacity-100" : disabled ? "opacity-60" : "opacity-72 hover:opacity-100"
                }`}
                style={{
                  transform: `translate(-50%, -50%) rotate(${item.iconAngle}deg) translate(${DESKTOP_QUICK_MENU_ICON_RADIUS}) rotate(${-item.iconAngle}deg)`,
                }}
              >
                <motion.span
                  className="flex h-full w-full items-center justify-center rounded-full"
                  animate={{ rotate: -ringRotation }}
                  transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
                >
                  <img
                    src={item.iconSrc}
                    alt=""
                    className={`h-full w-full object-contain transition-transform duration-300 ${
                      active ? "scale-105" : "scale-100"
                    }`}
                    aria-hidden="true"
                  />
                </motion.span>
              </button>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
};

const ExhibitionNotice = ({ visible }: { visible: boolean }) => (
  <AnimatePresence>
    {visible ? (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="pointer-events-none fixed left-1/2 top-1/2 z-[140] -translate-x-1/2 -translate-y-1/2"
      >
        <div className="whitespace-nowrap rounded-[1.1rem] border border-[#c5a57c]/32 bg-[#2d1b10]/86 px-7 py-4 text-center font-chinese text-[clamp(1rem,0.94rem+0.18vw,1.18rem)] leading-none tracking-[0.06em] text-[#f3e0c3] shadow-[0_18px_40px_rgba(0,0,0,0.34)] backdrop-blur-[5px]">
          {EXHIBITION_LOCKED_NOTICE}
        </div>
      </motion.div>
    ) : null}
  </AnimatePresence>
);

const EmptyDesktopPanel = () => (
  <FocusArea className="!max-w-none" showShadow={false}>
    <div className="pointer-events-none h-full w-full" />
  </FocusArea>
);

const ItemMemoryOverlay = ({
  item,
  language,
  onClose,
  onStartMemory,
}: {
  item: ItemArchiveEntry | null;
  language: Language;
  onClose: () => void;
  onStartMemory: (item: ItemArchiveEntry) => void;
}) => (
  <AnimatePresence>
    {item ? (
      <motion.div
        className="fixed inset-0 z-[85] flex items-center justify-center bg-black/58 backdrop-blur-[8px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.34, ease: "easeOut" }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.985 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="flex w-[min(34rem,72vw)] flex-col items-center text-center"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative flex h-[min(24rem,42vh)] w-[min(24rem,42vh)] items-center justify-center rounded-[1.2rem] border border-[#ead0a9]/28 bg-[radial-gradient(circle_at_50%_38%,rgba(225,190,137,0.22),rgba(61,37,22,0.74)_62%,rgba(24,13,8,0.86))] shadow-[0_22px_70px_rgba(0,0,0,0.56)]">
            <span className="absolute inset-[1.1rem] rounded-[0.9rem] border border-[#f2d9b5]/16" />
            <span className="absolute left-5 top-4 font-display text-[0.8rem] tracking-[0.18em] text-[#f2d9b5]/54">
              {item.mark}
            </span>
            <Package className="h-[38%] w-[38%] text-[#efd5ad]/72 drop-shadow-[0_8px_18px_rgba(0,0,0,0.42)]" strokeWidth={1.25} />
            <span className="absolute bottom-5 font-chinese text-[clamp(1rem,0.86rem+0.32vw,1.26rem)] tracking-[0.14em] text-[#f5dfbf]">
              {item.title[language]}
            </span>
          </div>
          <p className="mt-8 max-w-[42rem] font-chinese text-[clamp(1rem,0.82rem+0.34vw,1.32rem)] leading-[1.72] tracking-[0.08em] text-[#f1dfc4]/86 drop-shadow-[0_2px_12px_rgba(0,0,0,0.72)]">
            {item.description[language]}
          </p>
          <button
            type="button"
            onClick={() => onStartMemory(item)}
            className="mt-7 rounded-full border border-[#e7c797]/34 bg-[#180d08]/42 px-7 py-3 font-chinese text-[0.98rem] tracking-[0.18em] text-[#f1dfc4]/86 shadow-[0_12px_34px_rgba(0,0,0,0.36)] backdrop-blur-md transition-all hover:border-[#f0d2a0]/64 hover:bg-[#f0d2a0]/10 hover:text-[#fff2dc]"
          >
            {language === "en" ? "Start Memory" : "开始回忆"}
          </button>
        </motion.div>
      </motion.div>
    ) : null}
  </AnimatePresence>
);

const ItemArchivePanel = ({
  language,
  onStartMemory,
}: {
  language: Language;
  onStartMemory: (chapterId: string) => void;
}) => {
  const [selectedItem, setSelectedItem] = useState<ItemArchiveEntry | null>(null);

  return (
    <FocusArea className="!max-w-none" showShadow={false}>
      <div className="relative h-full w-full">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_48%_48%,rgba(56,34,20,0.08),rgba(7,4,2,0.3)_100%)]" />

        <motion.div
          initial={{ opacity: 0, x: "-50%", y: 10 }}
          animate={{ opacity: 1, x: "-50%", y: 0 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
          className="absolute left-1/2 top-[12.4%] z-20 h-[74%] w-[63%] max-w-[69rem]"
        >
          <div className="relative h-full rounded-[1.7rem] border border-[#d6ae78]/24 bg-[linear-gradient(135deg,rgba(68,39,21,0.76),rgba(30,17,10,0.82)_58%,rgba(16,9,6,0.88))] p-[clamp(1rem,1.2vw,1.65rem)] shadow-[0_26px_70px_rgba(0,0,0,0.48),inset_0_0_42px_rgba(229,190,137,0.08)] backdrop-blur-[2px]">
            <div className="pointer-events-none absolute inset-[0.7rem] rounded-[1.15rem] border border-[#f1d0a2]/10" />
            <div className="relative flex h-full flex-col">
              <div className="mb-4 flex items-end justify-between gap-5">
                <div>
                  <p className="font-display text-[0.72rem] uppercase tracking-[0.34em] text-[#d6ae78]/48">
                    {language === "en" ? "Item Drawer" : "物品抽屉"}
                  </p>
                  <h2 className="mt-2 font-chinese text-[clamp(1.45rem,1.08rem+0.75vw,2.25rem)] tracking-[0.16em] text-[#f1dfc4]">
                    {language === "en" ? "Inventory" : "物品"}
                  </h2>
                </div>
                <p className="max-w-[22rem] text-right font-chinese text-[clamp(0.78rem,0.68rem+0.18vw,0.96rem)] leading-[1.7] tracking-[0.06em] text-[#ead5b6]/54">
                  {language === "en"
                    ? "Select an object to inspect it. Memories can branch from here later."
                    : "点击物品查看描述；之后每个格子都可以接入独立支线回忆。"}
                </p>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-[clamp(0.7rem,0.9vw,1.05rem)]">
                {itemArchiveEntries.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItem(item)}
                    className="group relative overflow-hidden rounded-[1rem] border border-[#d8b27d]/18 bg-[linear-gradient(145deg,rgba(134,88,49,0.26),rgba(31,18,11,0.68))] p-4 text-left shadow-[inset_0_0_24px_rgba(5,3,2,0.38)] transition-all hover:-translate-y-0.5 hover:border-[#f1d0a2]/38 hover:bg-[linear-gradient(145deg,rgba(152,102,58,0.34),rgba(36,21,12,0.72))]"
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#f3d7ac]/24" />
                    <span className="pointer-events-none absolute bottom-0 left-0 h-[42%] w-full bg-[linear-gradient(to_top,rgba(0,0,0,0.25),transparent)]" />
                    <span className="absolute right-4 top-3 font-display text-[0.8rem] tracking-[0.18em] text-[#dfbd87]/40">
                      {item.mark}
                    </span>
                    <span className="flex h-full flex-col justify-between">
                      <span className="flex h-[58%] items-center justify-center rounded-[0.75rem] border border-[#f0d0a0]/10 bg-black/10">
                        <Package className="h-[42%] w-[42%] text-[#d8b27d]/58 transition-all group-hover:scale-105 group-hover:text-[#f3d7ac]/76" strokeWidth={1.2} />
                      </span>
                      <span className="font-chinese text-[clamp(0.96rem,0.82rem+0.24vw,1.22rem)] tracking-[0.12em] text-[#ead5b6]/78 group-hover:text-[#fff0d8]">
                        {item.title[language]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        <ItemMemoryOverlay
          item={selectedItem}
          language={language}
          onClose={() => setSelectedItem(null)}
          onStartMemory={(item) => {
            setSelectedItem(null);
            onStartMemory(item.memoryChapterId);
          }}
        />
      </div>
    </FocusArea>
  );
};

const CodexArchivePanel = ({ language }: { language: Language }) => {
  const [activeCategory, setActiveCategory] = useState<CodexCategoryId>("people");
  const activeCategoryMeta = codexCategories.find((category) => category.id === activeCategory) ?? codexCategories[0];
  const activeEntries = codexEntries.filter((entry) => entry.category === activeCategory);
  const activeUnlockedCount = activeEntries.filter((entry) => entry.unlocked).length;
  const totalUnlockedCount = codexEntries.filter((entry) => entry.unlocked).length;
  const totalCodexCount = codexCategories.reduce((sum, category) => sum + category.total, 0);

  return (
    <FocusArea className="!max-w-none" showShadow={false}>
      <div className="relative h-full w-full">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_46%_46%,rgba(67,42,24,0.1),rgba(5,3,2,0.34)_100%)]" />

        <motion.div
          initial={{ opacity: 0, x: "-50%", y: 10 }}
          animate={{ opacity: 1, x: "-50%", y: 0 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
          className="absolute left-1/2 top-[10.8%] z-20 h-[77%] w-[66%] max-w-[74rem]"
        >
          <div className="relative h-full overflow-hidden rounded-[1.7rem] border border-[#d6ae78]/22 bg-[linear-gradient(135deg,rgba(57,35,21,0.78),rgba(24,15,10,0.86)_58%,rgba(12,8,5,0.9))] p-[clamp(1rem,1.1vw,1.65rem)] shadow-[0_26px_70px_rgba(0,0,0,0.5),inset_0_0_46px_rgba(229,190,137,0.07)] backdrop-blur-[2px]">
            <div className="pointer-events-none absolute inset-[0.7rem] rounded-[1.15rem] border border-[#f1d0a2]/10" />
            <div className="relative flex h-full flex-col">
              <div className="mb-4 flex items-start justify-between gap-6">
                <div>
                  <p className="font-display text-[0.72rem] uppercase tracking-[0.34em] text-[#d6ae78]/48">
                    {language === "en" ? "World Codex" : "世界图鉴"}
                  </p>
                  <h2 className="mt-2 font-chinese text-[clamp(1.45rem,1.08rem+0.75vw,2.25rem)] tracking-[0.16em] text-[#f1dfc4]">
                    {language === "en" ? "Archive Index" : "探索档案"}
                  </h2>
                </div>

                <div className="min-w-[9rem] rounded-[1rem] border border-[#e2bf8c]/18 bg-black/18 px-4 py-3 text-right shadow-[inset_0_0_20px_rgba(0,0,0,0.24)]">
                  <p className="font-chinese text-[0.72rem] tracking-[0.16em] text-[#e8cfaa]/52">
                    {language === "en" ? "Collected" : "总收集"}
                  </p>
                  <p className="mt-1 font-display text-[1.28rem] tracking-[0.14em] text-[#f2d9b5]/88">
                    {String(totalUnlockedCount).padStart(2, "0")} / {String(totalCodexCount).padStart(2, "0")}
                  </p>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-3">
                {codexCategories.map((category) => {
                  const isActive = category.id === activeCategory;
                  const categoryUnlockedCount = codexEntries.filter(
                    (entry) => entry.category === category.id && entry.unlocked,
                  ).length;

                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setActiveCategory(category.id)}
                      className={`rounded-full border px-5 py-2 font-chinese text-[0.9rem] tracking-[0.13em] transition-all ${
                        isActive
                          ? "border-[#f0d6af]/52 bg-[#f0d6af]/14 text-[#fff1da]"
                          : "border-[#f0d6af]/16 bg-black/12 text-[#e8cfaa]/62 hover:border-[#f0d6af]/34 hover:text-[#fff0d4]"
                      }`}
                    >
                      <span>{category.label[language]}</span>
                      <span className="ml-3 font-display text-[0.78rem] tracking-[0.1em] opacity-70">
                        {categoryUnlockedCount}/{category.total}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mb-3 flex items-center justify-between">
                <p className="font-chinese text-[0.82rem] tracking-[0.14em] text-[#e8cfaa]/58">
                  {activeCategoryMeta.label[language]}
                </p>
                <p className="font-display text-[0.88rem] tracking-[0.18em] text-[#f0d6af]/72">
                  {String(activeUnlockedCount).padStart(2, "0")} / {String(activeCategoryMeta.total).padStart(2, "0")}
                </p>
              </div>

              <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-6 gap-[clamp(0.48rem,0.62vw,0.78rem)] overflow-hidden">
                {activeEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={!entry.unlocked}
                    className={`group relative overflow-hidden rounded-[0.82rem] border p-2 text-left shadow-[inset_0_0_18px_rgba(5,3,2,0.34)] transition-all ${
                      entry.unlocked
                        ? "border-[#d8b27d]/20 bg-[linear-gradient(145deg,rgba(134,88,49,0.22),rgba(29,18,12,0.68))] hover:-translate-y-0.5 hover:border-[#f1d0a2]/40"
                        : "cursor-default border-[#d8b27d]/10 bg-[linear-gradient(145deg,rgba(18,13,10,0.72),rgba(5,4,3,0.82))]"
                    }`}
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#f3d7ac]/18" />
                    <span className="absolute right-2 top-2 font-display text-[0.62rem] tracking-[0.14em] text-[#dfbd87]/34">
                      {entry.mark}
                    </span>

                    <span className="flex h-full min-h-[5.1rem] flex-col justify-between">
                      <span
                        className={`relative flex flex-1 items-center justify-center rounded-[0.62rem] border ${
                          entry.unlocked
                            ? "border-[#f0d0a0]/12 bg-[#2b1c11]/38"
                            : "border-[#f0d0a0]/6 bg-black/38"
                        }`}
                      >
                        {entry.unlocked ? (
                          <LibraryBig
                            className="h-[42%] w-[42%] text-[#d8b27d]/62 transition-all group-hover:scale-105 group-hover:text-[#f3d7ac]/76"
                            strokeWidth={1.18}
                          />
                        ) : (
                          <>
                            <span className="h-[42%] w-[42%] rounded-[42%_58%_46%_54%] bg-black/76 blur-[0.5px]" />
                            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent,rgba(0,0,0,0.42))]" />
                          </>
                        )}
                      </span>

                      <span
                        className={`mt-2 truncate text-center font-chinese text-[clamp(0.72rem,0.62rem+0.18vw,0.9rem)] tracking-[0.08em] ${
                          entry.unlocked ? "text-[#ead5b6]/76" : "text-[#ead5b6]/18"
                        }`}
                      >
                        {entry.unlocked ? entry.title[language] : language === "en" ? "Unknown" : "未知"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </FocusArea>
  );
};

const MapArchivePanel = ({ language }: { language: Language }) => {
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const hoveredRegion = mapRegions.find((region) => region.id === hoveredRegionId) ?? null;

  return (
    <FocusArea className="!max-w-none" showShadow={false}>
      <div className="relative h-full w-full">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_47%_46%,rgba(67,42,24,0.09),rgba(5,3,2,0.32)_100%)]" />

        <motion.div
          initial={{ opacity: 0, x: "-50%", y: 10 }}
          animate={{ opacity: 1, x: "-50%", y: 0 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
          className="absolute left-1/2 top-[10.5%] z-20 h-[77.5%] w-[68%] max-w-[78rem]"
        >
          <div className="relative h-full overflow-hidden rounded-[1.7rem] border border-[#d6ae78]/22 bg-[linear-gradient(135deg,rgba(59,38,23,0.76),rgba(24,15,10,0.86)_58%,rgba(12,8,5,0.9))] p-[clamp(1rem,1.1vw,1.65rem)] shadow-[0_26px_70px_rgba(0,0,0,0.5),inset_0_0_46px_rgba(229,190,137,0.07)] backdrop-blur-[2px]">
            <div className="pointer-events-none absolute inset-[0.7rem] rounded-[1.15rem] border border-[#f1d0a2]/10" />

            <div className="relative flex h-full flex-col">
              <div className="mb-4 flex items-start justify-between gap-6">
                <div>
                  <p className="font-display text-[0.72rem] uppercase tracking-[0.34em] text-[#d6ae78]/48">
                    {language === "en" ? "World Map" : "世界地图"}
                  </p>
                  <h2 className="mt-2 font-chinese text-[clamp(1.45rem,1.08rem+0.75vw,2.25rem)] tracking-[0.16em] text-[#f1dfc4]">
                    {language === "en" ? "Afterland Atlas" : "阿弗兰地图集"}
                  </h2>
                </div>

                <div className="min-w-[12rem] rounded-[1rem] border border-[#e2bf8c]/18 bg-black/18 px-4 py-3 text-right shadow-[inset_0_0_20px_rgba(0,0,0,0.24)]">
                  <p className="font-chinese text-[0.72rem] tracking-[0.16em] text-[#e8cfaa]/52">
                    {language === "en" ? "Regions" : "地图区块"}
                  </p>
                  <p className="mt-1 font-chinese text-[1.22rem] tracking-[0.16em] text-[#f2d9b5]/88">
                    {mapRegions.length}
                  </p>
                </div>
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.2rem] border border-[#d8b27d]/18 bg-[#b68a58] shadow-[inset_0_0_46px_rgba(52,31,17,0.42)]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_42%_32%,rgba(255,236,194,0.24),transparent_38%),linear-gradient(135deg,rgba(239,205,154,0.72),rgba(151,101,59,0.72)_55%,rgba(82,52,30,0.82))]" />
                <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(70,45,24,0.7)_1px,transparent_1px),linear-gradient(90deg,rgba(70,45,24,0.7)_1px,transparent_1px)] [background-size:52px_52px]" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_54%,rgba(44,25,13,0.34)_100%)]" />

                <svg
                  viewBox="0 0 1024 768"
                  className="absolute inset-0 h-full w-full"
                  role="img"
                  aria-label={language === "en" ? "Afterland world map" : "阿弗兰世界地图"}
                  onMouseLeave={() => setHoveredRegionId(null)}
                >
                  <defs>
                    <filter id="afterland-map-region-shadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="7" stdDeviation="6" floodColor="#2c190d" floodOpacity="0.42" />
                    </filter>
                  </defs>

                  <path
                    d="M72 98 C208 38 334 60 456 92 C560 118 662 62 786 92 C888 118 952 198 956 310 C960 424 900 542 814 622 C724 706 598 728 472 696 C356 666 270 720 166 648 C70 582 44 456 60 330 C70 246 22 162 72 98 Z"
                    fill="rgba(80,48,26,0.12)"
                    stroke="rgba(77,48,27,0.22)"
                    strokeWidth="2"
                  />

                  {mapRegions.map((region) => {
                    const active = hoveredRegionId === region.id;
                    return (
                      <g key={region.id}>
                        <polygon
                          points={region.points}
                          className="cursor-pointer transition-all duration-200"
                          fill={active ? "rgba(126,78,39,0.58)" : "rgba(111,73,41,0.36)"}
                          stroke={active ? "rgba(246,217,173,0.78)" : "rgba(84,54,30,0.5)"}
                          strokeWidth={active ? 4 : 2}
                          filter="url(#afterland-map-region-shadow)"
                          onMouseEnter={() => setHoveredRegionId(region.id)}
                          onFocus={() => setHoveredRegionId(region.id)}
                          tabIndex={0}
                        />
                        <circle
                          cx={region.labelX}
                          cy={region.labelY}
                          r={active ? 6 : 4}
                          fill={active ? "rgba(255,235,195,0.92)" : "rgba(92,57,30,0.62)"}
                        />
                      </g>
                    );
                  })}
                </svg>

                <AnimatePresence>
                  {hoveredRegion ? (
                    <motion.div
                      key={hoveredRegion.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#f3d7ac]/28 bg-[#23140c]/58 px-6 py-2 font-chinese text-[clamp(1rem,0.86rem+0.32vw,1.32rem)] tracking-[0.18em] text-[#fff0d8] shadow-[0_12px_28px_rgba(0,0,0,0.32)] backdrop-blur-md"
                      style={{
                        left: `${(hoveredRegion.labelX / 1024) * 100}%`,
                        top: `${(hoveredRegion.labelY / 768) * 100}%`,
                      }}
                    >
                      {hoveredRegion.name}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </FocusArea>
  );
};

type NotebookSectionId = "journal" | "friends" | "relics";

type NotebookEntry = {
  id: string;
  order: string;
  date: string;
  title: LocalizedCopy;
  textContent: LocalizedCopy;
  imageSlot?: string;
};

const NOTEBOOK_SECTION_LABELS: Record<NotebookSectionId, LocalizedCopy> = {
  journal: copy("日记", "Journal"),
  friends: copy("朋友", "Friends"),
  relics: copy("线索", "Clues"),
};

const friendEntries: NotebookEntry[] = [
  {
    id: "FR-01",
    order: "I",
    date: "398Y·8D·03R",
    title: copy("桥 Jo", "Jo"),
    textContent: copy(
      "人物档案占位。\n这里之后可以记录桥的关系状态、好感度变化、关键对话和支线线索。\n当前先建立朋友分页入口。",
      "Character profile placeholder.\nThis page can later track Jo's relationship state, affinity changes, key dialogue, and side-story clues.\nFor now, the friend page channel is in place."
    ),
  },
  {
    id: "FR-02",
    order: "II",
    date: "399Y·2D·11R",
    title: copy("坎瑟 Cancer", "Cancer"),
    textContent: copy(
      "人物档案占位。\n这里之后可以放入坎瑟的背景、阵营关系、已解锁情报与剧情分支备注。\n当前先保留为可翻页内容。",
      "Character profile placeholder.\nThis page can later hold Cancer's background, faction ties, unlocked intel, and branch notes.\nFor now, it remains a pageable entry."
    ),
  },
  {
    id: "FR-03",
    order: "III",
    date: "399Y·5D·18R",
    title: copy("狄崖 Tia", "Tia"),
    textContent: copy(
      "人物档案占位。\n这里之后可以记录狄崖的相遇事件、可解锁片段和与主线相关的线索。\n当前先建立第三个朋友页。",
      "Character profile placeholder.\nThis page can later record Tia's encounter events, unlockable fragments, and main-story clues.\nFor now, this establishes the third friend page."
    ),
  },
  {
    id: "FR-04",
    order: "IV",
    date: "400Y·1D·26R",
    title: copy("戈力 Grid", "Grid"),
    textContent: copy(
      "人物档案占位。\n这里之后可以放入戈力的状态、信任阈值、支线触发条件和已获得信息。\n当前先建立第四个朋友页。",
      "Character profile placeholder.\nThis page can later hold Grid's status, trust thresholds, side-story triggers, and collected information.\nFor now, this establishes the fourth friend page."
    ),
  },
];

const relicEntries: NotebookEntry[] = [
  {
    id: "RL-01",
    order: "I",
    date: "400Y·1D·02R",
    title: copy("信物 A", "Relic A"),
    textContent: copy(
      "信物档案占位。\n这里之后可以记录信物 A 的获得方式、解锁条件、关联人物和相关剧情片段。\n当前先建立信物分页入口。",
      "Relic profile placeholder.\nThis page can later track Relic A's acquisition, unlock conditions, related characters, and story fragments.\nFor now, the relic page channel is in place."
    ),
  },
  {
    id: "RL-02",
    order: "II",
    date: "400Y·5D·09R",
    title: copy("信物 B", "Relic B"),
    textContent: copy(
      "信物档案占位。\n这里之后可以放入信物 B 的描述、状态、来源，以及它触发的额外叙事线索。\n当前先保留为可翻页内容。",
      "Relic profile placeholder.\nThis page can later hold Relic B's description, state, origin, and extra narrative clues it unlocks.\nFor now, it remains a pageable entry."
    ),
  },
  {
    id: "RL-03",
    order: "III",
    date: "401Y·2D·17R",
    title: copy("信物 C", "Relic C"),
    textContent: copy(
      "信物档案占位。\n这里之后可以记录信物 C 的发现地点、持有者变化和与主线相关的提示。\n当前先建立第三个信物页。",
      "Relic profile placeholder.\nThis page can later record Relic C's discovery location, ownership changes, and main-story hints.\nFor now, this establishes the third relic page."
    ),
  },
  {
    id: "RL-04",
    order: "IV",
    date: "401Y·6D·28R",
    title: copy("信物 D", "Relic D"),
    textContent: copy(
      "信物档案占位。\n这里之后可以放入信物 D 的解锁状态、记忆片段和关联支线入口。\n当前先建立第四个信物页。",
      "Relic profile placeholder.\nThis page can later hold Relic D's unlock state, memory fragments, and linked side-story entry points.\nFor now, this establishes the fourth relic page."
    ),
  },
];

const CollectiblePeekCard = ({
  imageSrc,
  label,
  onOpen,
  nudgeCount,
}: {
  imageSrc: string;
  label: string;
  onOpen: () => void;
  nudgeCount: number;
}) => {
  const controls = useAnimationControls();
  const isLargeNotice = label === C002_RELIC_ID;

  useEffect(() => {
    void controls.start({
      opacity: 0.94,
      x: 0,
      rotate: 5,
      transition: { duration: 0.58, ease: [0.22, 1, 0.36, 1] },
    });
  }, [controls]);

  useEffect(() => {
    if (nudgeCount <= 0) {
      return;
    }

    void controls.start({
      opacity: 0.98,
      x: [0, 18, -9, 12, 0],
      rotate: [5, 7.5, 3.5, 6.2, 5],
      transition: { duration: 0.54, ease: "easeInOut" },
    });
  }, [controls, nudgeCount]);

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: -56, rotate: 4 }}
      animate={controls}
      exit={{ opacity: 0, x: -36 }}
      whileHover={{ x: 22, rotate: 6.5 }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={`absolute left-full top-[15%] z-[8] h-[70%] w-auto origin-left bg-transparent p-0 ${
        isLargeNotice ? "drop-shadow-none" : "drop-shadow-[0_18px_32px_rgba(0,0,0,0.46)]"
      }`}
      aria-label={label}
    >
      <img
        src={imageSrc}
        alt=""
        className="pointer-events-none h-full w-auto max-w-none -translate-x-[85%] rounded-[0.45rem] object-contain select-none"
        draggable={false}
      />
    </motion.button>
  );
};

const CollectibleInspectOverlay = ({
  open,
  imageSrc,
  clueId,
  description,
  actionLabel,
  onConfirm,
}: {
  open: boolean;
  imageSrc: string;
  clueId?: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void;
}) => {
  const isLargeNotice = clueId === C002_RELIC_ID;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[45] flex items-center justify-center bg-black/62 backdrop-blur-[9px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.34, ease: "easeOut" }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            className={`flex flex-col items-center text-center ${isLargeNotice ? "w-[min(54rem,86vw)]" : "w-[min(36rem,76vw)]"}`}
          >
            <img
              src={imageSrc}
              alt=""
              className={
                isLargeNotice
                  ? "h-auto w-full rounded-[0.55rem] object-contain shadow-none"
                  : "h-[min(40rem,58vh)] w-auto rounded-[0.55rem] object-contain shadow-none"
              }
              draggable={false}
            />
            <p className="mt-8 max-w-[42rem] font-chinese text-[clamp(1rem,0.82rem+0.34vw,1.32rem)] leading-[1.72] tracking-[0.08em] text-[#f1dfc4]/86 drop-shadow-[0_2px_12px_rgba(0,0,0,0.72)]">
              {description}
            </p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onConfirm();
              }}
              className="mt-7 rounded-full border border-[#e7c797]/34 bg-[#180d08]/42 px-7 py-3 font-chinese text-[0.98rem] tracking-[0.18em] text-[#f1dfc4]/86 shadow-[0_12px_34px_rgba(0,0,0,0.36)] backdrop-blur-md transition-all hover:border-[#f0d2a0]/64 hover:bg-[#f0d2a0]/10 hover:text-[#fff2dc]"
            >
              {actionLabel}
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

const ChapterMusicController = ({
  src,
  shouldPlay,
  volume,
}: {
  src?: string;
  shouldPlay: boolean;
  volume: number;
}) => {
  const audioRefs = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null]);
  const fadeFrameRefs = useRef<[number | null, number | null]>([null, null]);
  const crossfadeTimeoutRef = useRef<number | null>(null);
  const activeIndexRef = useRef(0);
  const srcRef = useRef<string | null>(null);
  const shouldPlayRef = useRef(shouldPlay);
  const volumeRef = useRef(volume);

  const clearCrossfadeTimeout = useCallback(() => {
    if (crossfadeTimeoutRef.current !== null) {
      window.clearTimeout(crossfadeTimeoutRef.current);
      crossfadeTimeoutRef.current = null;
    }
  }, []);

  const stopFadeFrame = useCallback((index: 0 | 1) => {
    if (fadeFrameRefs.current[index] !== null) {
      window.cancelAnimationFrame(fadeFrameRefs.current[index]);
      fadeFrameRefs.current[index] = null;
    }
  }, []);

  const fadeAudioAtIndex = useCallback(
    (index: 0 | 1, targetVolume: number, duration: number, pauseAfterFade = false, resetAfterFade = false) => {
      const audio = audioRefs.current[index];
      if (!audio) return;

      stopFadeFrame(index);

      const clampedTarget = Math.min(1, Math.max(0, targetVolume));
      const startVolume = audio.volume;
      const startTime = window.performance.now();

      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        audio.volume = startVolume + (clampedTarget - startVolume) * progress;

        if (progress < 1) {
          fadeFrameRefs.current[index] = window.requestAnimationFrame(step);
          return;
        }

        fadeFrameRefs.current[index] = null;
        audio.volume = clampedTarget;

        if (pauseAfterFade && clampedTarget <= 0.001) {
          audio.pause();
          if (resetAfterFade) {
            try {
              audio.currentTime = 0;
            } catch {
              // Some browsers can reject currentTime changes before metadata is ready.
            }
          }
        }
      };

      fadeFrameRefs.current[index] = window.requestAnimationFrame(step);
    },
    [stopFadeFrame],
  );

  const prepareAudioAtIndex = useCallback((index: 0 | 1, nextSrc: string) => {
    const existingAudio = audioRefs.current[index];
    if (existingAudio?.dataset.afterlandSrc === nextSrc) {
      return existingAudio;
    }

    if (existingAudio) {
      existingAudio.pause();
      try {
        existingAudio.currentTime = 0;
      } catch {
        // Ignore early media seek errors.
      }
    }

    const audio = new Audio(nextSrc);
    audio.dataset.afterlandSrc = nextSrc;
    audio.loop = false;
    audio.preload = "auto";
    audio.volume = 0;
    audioRefs.current[index] = audio;
    return audio;
  }, []);

  const resetChapterMusicNow = useCallback(() => {
    clearCrossfadeTimeout();
    ([0, 1] as const).forEach((index) => {
      stopFadeFrame(index);
      const audio = audioRefs.current[index];
      if (!audio) return;

      audio.pause();
      audio.volume = 0;
      try {
        audio.currentTime = 0;
      } catch {
        // Ignore early media seek errors.
      }
    });
    srcRef.current = null;
    activeIndexRef.current = 0;
  }, [clearCrossfadeTimeout, stopFadeFrame]);

  const scheduleCrossfade = useCallback(
    (currentIndex: 0 | 1, currentSrc: string) => {
      clearCrossfadeTimeout();
      const currentAudio = audioRefs.current[currentIndex];
      if (!currentAudio) return;

      const schedule = () => {
        if (!shouldPlayRef.current || srcRef.current !== currentSrc) return;

        const duration = Number.isFinite(currentAudio.duration) ? currentAudio.duration : 0;
        const remainingSeconds = duration - currentAudio.currentTime - CHAPTER_MUSIC_CROSSFADE_SECONDS;
        const delay = Math.max(0, remainingSeconds * 1000);

        crossfadeTimeoutRef.current = window.setTimeout(() => {
          if (!shouldPlayRef.current || srcRef.current !== currentSrc) return;

          const nextIndex = currentIndex === 0 ? 1 : 0;
          const nextAudio = prepareAudioAtIndex(nextIndex, currentSrc);
          nextAudio.volume = 0;
          try {
            nextAudio.currentTime = 0;
          } catch {
            // Ignore early media seek errors.
          }

          void nextAudio
            .play()
            .then(() => {
              fadeAudioAtIndex(currentIndex, 0, CHAPTER_MUSIC_CROSSFADE_SECONDS * 1000, true, true);
              fadeAudioAtIndex(nextIndex, volumeRef.current, CHAPTER_MUSIC_CROSSFADE_SECONDS * 1000);
              activeIndexRef.current = nextIndex;
              scheduleCrossfade(nextIndex, currentSrc);
            })
            .catch(() => {
              // Playback will be retried on the next user interaction.
            });
        }, delay);
      };

      if (Number.isFinite(currentAudio.duration) && currentAudio.duration > 0) {
        schedule();
        return;
      }

      currentAudio.addEventListener("loadedmetadata", schedule, { once: true });
    },
    [clearCrossfadeTimeout, fadeAudioAtIndex, prepareAudioAtIndex],
  );

  const startChapterMusic = useCallback(
    (nextSrc: string, restart: boolean) => {
      if (restart) {
        resetChapterMusicNow();
      }

      const activeIndex = restart ? 0 : activeIndexRef.current;
      const standbyIndex = activeIndex === 0 ? 1 : 0;
      const activeAudio = prepareAudioAtIndex(activeIndex, nextSrc);
      const standbyAudio = prepareAudioAtIndex(standbyIndex, nextSrc);

      srcRef.current = nextSrc;
      activeIndexRef.current = activeIndex;
      standbyAudio.pause();
      standbyAudio.volume = 0;
      try {
        standbyAudio.currentTime = 0;
        if (restart) {
          activeAudio.currentTime = 0;
        }
      } catch {
        // Ignore early media seek errors.
      }

      void activeAudio
        .play()
        .then(() => {
          fadeAudioAtIndex(activeIndex, volumeRef.current, CHAPTER_MUSIC_FADE_MS);
          scheduleCrossfade(activeIndex, nextSrc);
        })
        .catch(() => {
          // Browser autoplay protection may block initial playback until the next user gesture.
        });
    },
    [fadeAudioAtIndex, prepareAudioAtIndex, resetChapterMusicNow, scheduleCrossfade],
  );

  useEffect(() => {
    shouldPlayRef.current = shouldPlay;
    volumeRef.current = volume;
  }, [shouldPlay, volume]);

  useEffect(() => {
    if (!shouldPlay || !src) {
      clearCrossfadeTimeout();
      srcRef.current = null;
      ([0, 1] as const).forEach((index) => {
        const audio = audioRefs.current[index];
        if (audio && !audio.paused) {
          fadeAudioAtIndex(index, 0, 850, true, true);
        }
      });
      return;
    }

    startChapterMusic(src, srcRef.current !== src);
  }, [clearCrossfadeTimeout, fadeAudioAtIndex, shouldPlay, src, startChapterMusic]);

  useEffect(() => {
    volumeRef.current = volume;
    if (!shouldPlay) return;

    const activeIndex = activeIndexRef.current;
    fadeAudioAtIndex(activeIndex, volume, 260);
  }, [fadeAudioAtIndex, shouldPlay, volume]);

  useEffect(() => {
    const unlockPlayback = () => {
      if (!shouldPlayRef.current || !srcRef.current) return;

      const activeIndex = activeIndexRef.current;
      const activeAudio = audioRefs.current[activeIndex] ?? prepareAudioAtIndex(activeIndex, srcRef.current);

      if (!activeAudio.paused) return;

      void activeAudio
        .play()
        .then(() => {
          fadeAudioAtIndex(activeIndex, volumeRef.current, CHAPTER_MUSIC_FADE_MS);
          if (srcRef.current) {
            scheduleCrossfade(activeIndex, srcRef.current);
          }
        })
        .catch(() => {
          // Keep waiting for a valid user gesture.
        });
    };

    window.addEventListener("pointerdown", unlockPlayback);
    window.addEventListener("keydown", unlockPlayback);
    window.addEventListener("touchstart", unlockPlayback, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", unlockPlayback);
      window.removeEventListener("keydown", unlockPlayback);
      window.removeEventListener("touchstart", unlockPlayback);
    };
  }, [fadeAudioAtIndex, prepareAudioAtIndex, scheduleCrossfade]);

  useEffect(() => resetChapterMusicNow, [resetChapterMusicNow]);

  return null;
};

const DiaryArtifactView = ({
  language,
  ui,
  activeChapter,
  setActiveChapter,
  isEchoing,
  setIsEchoing,
  bodyTextSizePt,
  autoPlayEnabled,
  autoPlaySpeed,
  memoryStartRequest,
  exhibitionMode = null,
  onLockedInteraction,
}: {
  language: Language;
  ui: (typeof UI_COPY)[Language];
  activeChapter: ChapterContent;
  setActiveChapter: (chapter: ChapterContent) => void;
  isEchoing: boolean;
  setIsEchoing: (value: boolean) => void;
  bodyTextSizePt: number;
  autoPlayEnabled: boolean;
  autoPlaySpeed: number;
  memoryStartRequest: MemoryStartRequest | null;
  exhibitionMode?: ExhibitionMode | null;
  onLockedInteraction?: () => void;
}) => {
  const isExhibitionMode = Boolean(exhibitionMode);
  const [activeSection, setActiveSection] = useState<NotebookSectionId>("journal");
  const [friendIndex, setFriendIndex] = useState(0);
  const [relicIndex, setRelicIndex] = useState(0);
  const [journalEchoState, setJournalEchoState] = useState(isEchoing);
  const [pendingSection, setPendingSection] = useState<NotebookSectionId | null>(null);
  const [isSectionPanelVisible, setIsSectionPanelVisible] = useState(true);
  const [collectedCollectibleIds, setCollectedCollectibleIds] = useState<CollectibleClueId[]>(() =>
    typeof window === "undefined" || isExhibitionMode
      ? []
      : COLLECTIBLE_CLUE_IDS.filter((id) => storageGetItem(COLLECTIBLE_CLUES[id].storageKey) === "true"),
  );
  const [unreadCollectibleIds, setUnreadCollectibleIds] = useState<CollectibleClueId[]>(() =>
    typeof window === "undefined" || isExhibitionMode
      ? []
      : COLLECTIBLE_CLUE_IDS.filter((id) => storageGetItem(COLLECTIBLE_CLUES[id].unreadStorageKey) === "true"),
  );
  const [pendingCollectibleId, setPendingCollectibleId] = useState<string | null>(() =>
    typeof window === "undefined" || isExhibitionMode
      ? null
      : (COLLECTIBLE_CLUE_IDS.find(
          (id) =>
            storageGetItem(COLLECTIBLE_CLUES[id].storageKey) !== "true" &&
            storageGetItem(COLLECTIBLE_CLUES[id].pendingStorageKey) === "true",
        ) ?? null),
  );
  const [inspectingCollectibleId, setInspectingCollectibleId] = useState<string | null>(null);
  const [collectibleHintVisible, setCollectibleHintVisible] = useState(false);
  const [collectibleNudgeCount, setCollectibleNudgeCount] = useState(0);
  const panelSwitchTimeoutRef = useRef<number | null>(null);
  const panelFadeInFrameRef = useRef<number | null>(null);
  const collectibleHintTimeoutRef = useRef<number | null>(null);
  const [chapterPanelVersions, setChapterPanelVersions] = useState<Record<string, number>>(() =>
    Object.fromEntries(chapters.map((chapter) => [chapter.id, 0])),
  );
  const [completedChapters, setCompletedChapters] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") {
      return Object.fromEntries(chapters.map((chapter) => [chapter.id, false]));
    }

    return Object.fromEntries(
      chapters.map((chapter) => [chapter.id, storageGetItem(getChapterCompletionKey(chapter.id)) === "true"]),
    );
  });
  const pageLang = language === "en" ? "en" : "zh-CN";
  const narrativeChapters = getNarrativeChapters();
  const journalIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === activeChapter.id));
  const journalEntry = chapters[journalIndex] ?? chapters[0];
  const friendEntry = friendEntries[friendIndex] ?? friendEntries[0];
  const relicEntry = relicEntries[relicIndex] ?? relicEntries[0];
  const activeNonJournalEntries = activeSection === "friends" ? friendEntries : relicEntries;
  const activeNonJournalIndex = activeSection === "friends" ? friendIndex : relicIndex;
  const activeEchoLayout = activeSection === "journal" && journalEchoState;
  const pendingCollectible = getCollectibleClue(pendingCollectibleId);
  const inspectingCollectible = getCollectibleClue(inspectingCollectibleId);
  const isCollectibleInteractionOpen = Boolean(pendingCollectible || inspectingCollectible);
  const journalStaticContentKey = `journal-page-${journalEntry.id}`;
  const friendContentKey = `friends-${friendEntry.id}`;
  const relicContentKey = `relics-${relicEntry.id}`;
  const journalCanGoPrev = !isExhibitionMode && journalIndex > 0;
  const journalCanGoNext = !isExhibitionMode && journalIndex < chapters.length - 1;
  const nonJournalCanGoPrev = activeNonJournalIndex > 0;
  const nonJournalCanGoNext = activeNonJournalIndex < activeNonJournalEntries.length - 1;
  const canGoPrev = activeSection === "journal" ? journalCanGoPrev : nonJournalCanGoPrev;
  const canGoNext = activeSection === "journal" ? journalCanGoNext : nonJournalCanGoNext;
  const highlightedSection = pendingSection ?? activeSection;
  const handleNarrativeTag = useCallback((tag: string, value: string | null) => {
    console.log(`[Narrative Tag] ${tag}: ${value}`);
  }, []);

  const markCollectibleRead = useCallback((id: string) => {
    const clue = getCollectibleClue(id);
    if (!clue) {
      return;
    }

    setUnreadCollectibleIds((prev) => prev.filter((item) => item !== clue.id));
    storageRemoveItem(clue.unreadStorageKey);
  }, []);

  const handleCollectibleTrigger = useCallback(
    (id: string) => {
      const clue = getCollectibleClue(id);
      if (!clue) {
        return;
      }

      if (!isExhibitionMode) {
        storageSetItem(clue.pendingStorageKey, "true");
      }
      setCollectibleHintVisible(false);
      setPendingCollectibleId(clue.id);
    },
    [isExhibitionMode],
  );

  const handleCollectiblePausedAttempt = useCallback(() => {
    if (!pendingCollectible || inspectingCollectible) {
      return;
    }

    setCollectibleHintVisible(true);
    setCollectibleNudgeCount((prev) => prev + 1);

    if (collectibleHintTimeoutRef.current !== null) {
      window.clearTimeout(collectibleHintTimeoutRef.current);
    }

    collectibleHintTimeoutRef.current = window.setTimeout(() => {
      collectibleHintTimeoutRef.current = null;
      setCollectibleHintVisible(false);
    }, 2200);
  }, [inspectingCollectible, pendingCollectible]);

  const handleCollectibleConfirm = useCallback((id: string) => {
    const clue = getCollectibleClue(id);
    if (!clue) {
      return;
    }

    if (!isExhibitionMode) {
      storageSetItem(clue.storageKey, "true");
      storageRemoveItem(clue.pendingStorageKey);
    }
    setCollectedCollectibleIds((prev) => (prev.includes(clue.id) ? prev : [...prev, clue.id]));
    setPendingCollectibleId(null);
    setInspectingCollectibleId(null);
    setCollectibleHintVisible(false);

    if (isExhibitionMode) {
      return;
    }

    if (activeSection === "relics") {
      markCollectibleRead(clue.id);
      return;
    }

    storageSetItem(clue.unreadStorageKey, "true");
    setUnreadCollectibleIds((prev) => (prev.includes(clue.id) ? prev : [...prev, clue.id]));
  }, [activeSection, isExhibitionMode, markCollectibleRead]);

  useEffect(() => {
    setIsEchoing(activeSection === "journal" && journalEchoState);
  }, [activeSection, journalEchoState, setIsEchoing]);

  useEffect(() => {
    if (!memoryStartRequest) {
      return;
    }

    const memoryChapter = findNarrativeChapterById(memoryStartRequest.chapterId);
    if (!memoryChapter) {
      return;
    }

    setPendingSection(null);
    setIsSectionPanelVisible(true);
    setActiveSection("journal");
    setActiveChapter(memoryChapter);
    setJournalEchoState(true);
  }, [memoryStartRequest, setActiveChapter]);

  useEffect(() => {
    return () => {
      if (panelSwitchTimeoutRef.current !== null) {
        window.clearTimeout(panelSwitchTimeoutRef.current);
      }
      if (panelFadeInFrameRef.current !== null) {
        window.cancelAnimationFrame(panelFadeInFrameRef.current);
      }
      if (collectibleHintTimeoutRef.current !== null) {
        window.clearTimeout(collectibleHintTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingSection || isSectionPanelVisible) {
      return;
    }

    panelSwitchTimeoutRef.current = window.setTimeout(() => {
      panelSwitchTimeoutRef.current = null;
      setActiveSection(pendingSection);
      setPendingSection(null);

      panelFadeInFrameRef.current = window.requestAnimationFrame(() => {
        panelFadeInFrameRef.current = null;
        setIsSectionPanelVisible(true);
      });
    }, PAGE_FADE_TRANSITION.duration * 1000);

    return () => {
      if (panelSwitchTimeoutRef.current !== null) {
        window.clearTimeout(panelSwitchTimeoutRef.current);
        panelSwitchTimeoutRef.current = null;
      }
    };
  }, [isSectionPanelVisible, pendingSection]);

  const handleSelectSection = (section: NotebookSectionId) => {
    if (isExhibitionMode) {
      onLockedInteraction?.();
      return;
    }

    if (section === "relics" && unreadCollectibleIds.length > 0) {
      const firstUnreadClue = getCollectibleClue(unreadCollectibleIds[0]);
      const firstUnreadIndex = firstUnreadClue
        ? relicEntries.findIndex((entry) => entry.id === firstUnreadClue.relicEntryId)
        : -1;

      if (firstUnreadIndex >= 0) {
        setRelicIndex(firstUnreadIndex);
      }

      unreadCollectibleIds.forEach((id) => markCollectibleRead(id));
    }

    if ((pendingSection ?? activeSection) === section) {
      return;
    }

    setPendingSection(section);
    setIsSectionPanelVisible(false);
  };

  const beginJournalEcho = useCallback(
    (chapterId: string) => {
      if (isExhibitionMode && exhibitionMode) {
        clearReaderProgress({
          storyStorageKey: getExhibitionStoryStorageKey(exhibitionMode.slug, chapterId),
          readerStorageKey: getExhibitionReaderStorageKey(exhibitionMode.slug, chapterId),
        });
      } else {
        clearChapterProgress(chapterId);
      }

      setChapterPanelVersions((prev) => ({ ...prev, [chapterId]: (prev[chapterId] ?? 0) + 1 }));
      setJournalEchoState(true);
    },
    [exhibitionMode, isExhibitionMode],
  );

  const handleChapterReadComplete = (chapterId: string) => {
    if (isExhibitionMode && exhibitionMode) {
      clearReaderProgress({
        storyStorageKey: getExhibitionStoryStorageKey(exhibitionMode.slug, chapterId),
        readerStorageKey: getExhibitionReaderStorageKey(exhibitionMode.slug, chapterId),
      });
      setJournalEchoState(false);
      return;
    }

    clearChapterProgress(chapterId);
    storageSetItem(getChapterCompletionKey(chapterId), "true");
    const nextChapter = chapters[chapters.findIndex((chapter) => chapter.id === chapterId) + 1];
    if (nextChapter) {
      storageSetItem(getChapterUnlockKey(nextChapter.id), "true");
    }
    setCompletedChapters((prev) => ({ ...prev, [chapterId]: true }));
    setChapterPanelVersions((prev) => ({ ...prev, [chapterId]: (prev[chapterId] ?? 0) + 1 }));
    setJournalEchoState(false);
  };

  const handlePrev = () => {
    if (!canGoPrev) return;
    setJournalEchoState(false);

    if (activeSection === "journal") {
      setActiveChapter(chapters[journalIndex - 1]);
      return;
    }

    if (activeSection === "friends") {
      setFriendIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    setRelicIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    if (!canGoNext) return;
    setJournalEchoState(false);

    if (activeSection === "journal") {
      setActiveChapter(chapters[journalIndex + 1]);
      return;
    }

    if (activeSection === "friends") {
      setFriendIndex((prev) => Math.min(friendEntries.length - 1, prev + 1));
      return;
    }

    setRelicIndex((prev) => Math.min(relicEntries.length - 1, prev + 1));
  };

  const renderNotebookStaticPage = ({
    entry,
    section,
    enableEchoEntry = false,
  }: {
    entry: NotebookEntry;
    section: NotebookSectionId;
    enableEchoEntry?: boolean;
  }) => {
    const hasCompletedThisChapter = section === "journal" && Boolean(completedChapters[entry.id]);
    const showChapterSceneArtwork = section === "journal" && Boolean(entry.imageSlot);
    const showSupplementalArtwork = Boolean(entry.imageSlot) && !showChapterSceneArtwork;
    const collectedClueForEntry =
      section === "relics"
        ? COLLECTIBLE_CLUE_IDS.map((id) => COLLECTIBLE_CLUES[id]).find(
            (clue) => clue.relicEntryId === entry.id && collectedCollectibleIds.includes(clue.id),
          )
        : undefined;
    const showSectionPlaceholder = !entry.imageSlot && !showChapterSceneArtwork && !collectedClueForEntry;

    return (
      <>
        {showChapterSceneArtwork && entry.imageSlot ? (
          <img
            src={entry.imageSlot}
            alt=""
            className="pointer-events-auto absolute left-[13.5%] top-[13.4%] z-10 h-auto w-[74.5%] max-w-none object-contain opacity-65 mix-blend-multiply transition-opacity duration-300 hover:opacity-100 select-none"
            draggable={false}
          />
        ) : null}

        <div className="pointer-events-none absolute left-1/2 top-[9.8%] z-20 flex w-[22%] -translate-x-1/2 items-center justify-center text-[#8f8a74]/68">
          <span className="h-px flex-1 bg-current/70" />
          <span className="px-4 text-[clamp(1rem,0.86rem+0.42vw,1.42rem)] leading-none">❦</span>
          <span className="h-px flex-1 bg-current/70" />
        </div>

        <div className="absolute left-[15%] top-[9%] z-20 font-display text-[clamp(1.55rem,1.1rem+0.9vw,2.3rem)] font-semibold tracking-[0.08em] text-[#4a3429]/82">
          {entry.order}
        </div>

        <div className="absolute right-[12%] top-[9.5%] z-20 font-display text-[clamp(1.05rem,0.88rem+0.62vw,1.95rem)] font-semibold tracking-[0.08em] text-[#4a3429]/86">
          {entry.date}
        </div>

        <div
          className="absolute left-[14.5%] top-[18%] z-20 h-[36.2%] w-[24.2%] overflow-visible pr-2"
          lang={pageLang}
        >
          <div className="space-y-5">
            <h2 className="whitespace-nowrap font-chinese text-[clamp(1.95rem,1.42rem+1vw,3.1rem)] font-semibold leading-[1.14] tracking-[0.04em] text-[#624137]">
              {entry.title[language]}
            </h2>
            <div
              className="afterland-copy tracking-[0.02em] text-[#58453a]/84 whitespace-pre-line"
              style={{ fontSize: `${bodyTextSizePt}pt`, lineHeight: 1.5 }}
            >
              {entry.textContent[language]}
            </div>
          </div>
        </div>

        {section === "journal" && enableEchoEntry ? (
          <button
            type="button"
            data-reread={hasCompletedThisChapter ? "true" : "false"}
            onClick={() => {
              beginJournalEcho(entry.id);
            }}
            className="group absolute bottom-[11.2%] right-[15.6%] z-30 inline-flex bg-transparent px-1 py-1 text-left"
          >
            <span className="relative inline-block">
              <img
                src={chapterTitleHoverBrush}
                alt=""
                className="pointer-events-none absolute left-1/2 bottom-[0.12em] z-0 w-[110%] max-w-none -translate-x-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                draggable={false}
              />
              <span className="relative z-10 whitespace-nowrap font-chinese text-[clamp(1.86rem,1.34rem+1vw,3rem)] font-semibold leading-[1.05] tracking-[0.08em] text-[#624137] transition-colors group-hover:text-[#4B3027]">
                {ui.detail.startEcho}
              </span>
            </span>
          </button>
        ) : null}

        {collectedClueForEntry ? (
          <div
            className={`absolute z-20 ${
              collectedClueForEntry.id === C002_RELIC_ID ? "left-[25%] top-[15%] w-[64.5%]" : "left-[52.5%] top-[20%] w-[17.5%]"
            }`}
            lang={pageLang}
          >
            <img
              src={collectedClueForEntry.imageSrc}
              alt={collectedClueForEntry.id}
              className={`h-auto w-full rounded-[0.35rem] object-contain ${
                collectedClueForEntry.id === C002_RELIC_ID ? "rotate-[-0.7deg] shadow-none" : "rotate-[1.2deg] shadow-[0_12px_28px_rgba(42,24,12,0.24)]"
              }`}
              draggable={false}
            />
            <p
              className="mt-5 font-chinese leading-[1.65] tracking-[0.05em] text-[#6C3B0C]/78"
              style={{
                fontSize: `${
                  collectedClueForEntry.id === C002_RELIC_ID ? Math.max(8, bodyTextSizePt - 3) : Math.max(10, bodyTextSizePt - 1)
                }pt`,
                lineHeight: collectedClueForEntry.id === C002_RELIC_ID ? 1.45 : 1.65,
              }}
            >
              {collectedClueForEntry.description[language]}
            </p>
          </div>
        ) : showSupplementalArtwork ? (
          <div className="pointer-events-none absolute left-[29.2%] top-[18.2%] z-10 h-[66.4%] w-[58.8%]">
            <img
              src={entry.imageSlot}
              alt=""
              className="h-full w-full object-contain object-bottom grayscale sepia-[0.22] brightness-[1.6] contrast-[0.92] opacity-[0.38] mix-blend-multiply"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : showSectionPlaceholder ? (
          <div className="pointer-events-none absolute left-[29.2%] top-[18.2%] z-10 h-[66.4%] w-[58.8%]">
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-display text-[clamp(2.2rem,1.6rem+1.1vw,3.5rem)] tracking-[0.14em] text-[#544235]/16">
                {NOTEBOOK_SECTION_LABELS[section][language]}
              </span>
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const getPanelWrapperClassName = (section: NotebookSectionId) => {
    const isVisiblePanel = activeSection === section && isSectionPanelVisible;
    return `absolute inset-0 z-20 transition-opacity ${isVisiblePanel ? "opacity-100" : "pointer-events-none opacity-0"}`;
  };

  const panelWrapperStyle = {
    transitionDuration: `${PAGE_FADE_TRANSITION.duration}s`,
    transitionTimingFunction: PAGE_FADE_TRANSITION.ease,
  } as const;

  return (
    <FocusArea className="!max-w-none" showShadow={false}>
      <div className="relative h-full w-full">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_50%,rgba(8,4,2,0.16)_100%),linear-gradient(to_bottom,rgba(10,5,2,0.14),rgba(10,5,2,0.02)_34%,rgba(10,5,2,0.14))]" />

        <div
          className="afterland-book-scope absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          style={{
            aspectRatio: "2090 / 1521",
            height: `min(calc(max(100vh, ${MIN_STAGE_HEIGHT}px) - 3.2rem), calc(max(91vw, 1747px) * 1521 / 2090))`,
            maxWidth: "max(91vw, 1747px)",
          }}
        >
          <img
            src={diaryOpenBook}
            alt=""
            className="pointer-events-none absolute inset-0 z-10 h-full w-full object-contain drop-shadow-[0_24px_38px_rgba(0,0,0,0.42)] select-none"
            draggable={false}
          />

          <AnimatePresence>
            {pendingCollectible && !inspectingCollectible ? (
              <CollectiblePeekCard
                imageSrc={pendingCollectible.imageSrc}
                label={pendingCollectible.id}
                nudgeCount={collectibleNudgeCount}
                onOpen={() => {
                  setCollectibleHintVisible(false);
                  setInspectingCollectibleId(pendingCollectible.id);
                }}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {collectibleHintVisible && pendingCollectible && !inspectingCollectible ? (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 0.72, y: 0 }}
                exit={{ opacity: 0, y: 3 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="pointer-events-none absolute right-[12.2%] top-[40.5%] z-30 font-chinese text-[clamp(0.86rem,0.74rem+0.26vw,1.12rem)] tracking-[0.1em] text-[#6C3B0C]/68 drop-shadow-[0_1px_8px_rgba(255,241,210,0.55)]"
              >
                {pendingCollectible.hint[language]}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="absolute left-[-3.9%] top-[14%] z-40 flex h-[42%] w-[8%] flex-col items-start gap-0">
            {(["journal", "friends", "relics"] as const).map((section) => {
              const active = section === highlightedSection;
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => handleSelectSection(section)}
                  style={{
                    marginLeft:
                      section === "journal" ? "11pt" : section === "friends" ? "-5pt" : "-16pt",
                    marginTop: section === "journal" ? "0pt" : "-14pt",
                    zIndex: section === "journal" ? 3 : section === "friends" ? 2 : 1,
                  }}
                  className="group relative h-[31.5%] w-full shrink-0"
                >
                  <img
                    src={diaryTab}
                    alt=""
                    className={`pointer-events-none absolute inset-0 h-full w-full object-contain drop-shadow-[0_8px_12px_rgba(30,18,10,0.22)] ${
                      active ? "brightness-[1.02]" : "brightness-[0.9]"
                    }`}
                    draggable={false}
                  />
                  {!active && (
                    <span className="pointer-events-none absolute inset-0 bg-[#2a170d]/10 opacity-100 transition-opacity duration-150 mix-blend-multiply group-hover:opacity-0" />
                  )}
                  <span
                    className={`absolute inset-0 flex items-center justify-center px-[18%] text-center font-chinese text-[clamp(1rem,0.82rem+0.28vw,1.45rem)] font-semibold tracking-[0.1em] text-[#39251b] ${
                      section === "journal" ? "" : "opacity-40"
                    }`}
                  >
                    {NOTEBOOK_SECTION_LABELS[section][language]}
                  </span>
                  {section === "relics" && unreadCollectibleIds.length > 0 ? (
                    <span className="pointer-events-none absolute right-[18%] top-[23%] h-[0.46rem] w-[0.46rem] rounded-full bg-[#f2c35e] shadow-[0_0_10px_rgba(242,195,94,0.72)]" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="absolute inset-0">
            <div className={getPanelWrapperClassName("journal")} style={panelWrapperStyle}>
              <AnimatePresence mode="wait" initial={false}>
                {!journalEchoState ? (
                  <motion.div
                    key={journalStaticContentKey}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={PAGE_FADE_TRANSITION}
                    className="absolute inset-0"
                  >
                    {renderNotebookStaticPage({
                      entry: journalEntry,
                      section: "journal",
                      enableEchoEntry: true,
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {narrativeChapters.map((chapter) => {
                const isVisibleChapterPanel =
                  activeSection === "journal" &&
                  isSectionPanelVisible &&
                  journalEchoState &&
                  activeChapter.id === chapter.id;
                const chapterStoryData = STORY_BY_CHAPTER_ID[chapter.id] ?? storyData;
                const chapterInlineImageConfig = getStoryInlineImageConfig(chapter.id);
                const chapterStoryStorageKey =
                  isExhibitionMode && exhibitionMode
                    ? getExhibitionStoryStorageKey(exhibitionMode.slug, chapter.id)
                    : getStoryStorageKey(chapter.id);
                const chapterReaderStorageKey =
                  isExhibitionMode && exhibitionMode
                    ? getExhibitionReaderStorageKey(exhibitionMode.slug, chapter.id)
                    : getReaderStorageKey(chapter.id);
                const chapterVersion = chapterPanelVersions[chapter.id] ?? 0;
                const chapterTotalCharacterCount = countInkStoryCharacters(chapterStoryData, chapter.storyPath);

                return (
                  <div
                    key={`journal-panel-${chapter.id}-${chapterVersion}`}
                    className={`absolute inset-0 z-20 transition-opacity ${
                      isVisibleChapterPanel ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                    style={panelWrapperStyle}
                  >
                    <div className="absolute inset-0" lang={pageLang}>
                      <StoryProvider
                        storyJson={chapterStoryData}
                        storageKey={chapterStoryStorageKey}
                        initialPath={chapter.storyPath}
                        onTag={handleNarrativeTag}
                      >
                        <JournalPage
                          layout="notebookSpread"
                          isActive={isVisibleChapterPanel}
                          ui={{
                            choicePrefix: ui.detail.choicePrefix,
                            continueHint: ui.detail.continueHint,
                            narrativeEnded: ui.detail.narrativeEnded,
                            tutorial: ui.detail.tutorial,
                          }}
                          inlineImageConfig={chapterInlineImageConfig}
                          bodyTextSizePt={bodyTextSizePt}
                          storyJson={chapterStoryData}
                          totalCharacterCount={chapterTotalCharacterCount}
                          progressStorageKey={chapterReaderStorageKey}
                          storyStorageKey={chapterStoryStorageKey}
                          collectibleTriggers={STORY_COLLECTIBLE_TRIGGERS_BY_CHAPTER_ID[chapter.id]}
                          onCollectibleTrigger={handleCollectibleTrigger}
                          isPaused={isCollectibleInteractionOpen}
                          onPausedAdvanceAttempt={handleCollectiblePausedAttempt}
                          autoPlayEnabled={autoPlayEnabled}
                          autoPlaySpeed={autoPlaySpeed}
                          onReadComplete={() => {
                            handleChapterReadComplete(chapter.id);
                          }}
                          notebookSpreadControls={{
                            backLabel: ui.detail.backToChapter,
                            onExit: () => {
                              setJournalEchoState(false);
                            },
                            prevArrowSrc: diaryArrowPrev,
                            nextArrowSrc: diaryArrowNext,
                          }}
                        />
                      </StoryProvider>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={getPanelWrapperClassName("friends")} style={panelWrapperStyle}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={friendContentKey}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={PAGE_FADE_TRANSITION}
                  className="absolute inset-0 z-20"
                >
                  {renderNotebookStaticPage({
                    entry: friendEntry,
                    section: "friends",
                  })}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className={getPanelWrapperClassName("relics")} style={panelWrapperStyle}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={relicContentKey}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={PAGE_FADE_TRANSITION}
                  className="absolute inset-0 z-20"
                >
                  {renderNotebookStaticPage({
                    entry: relicEntry,
                    section: "relics",
                  })}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {!activeEchoLayout && !isExhibitionMode ? (
            <>
              <button
                type="button"
                onClick={handlePrev}
                disabled={!canGoPrev}
                className={`absolute bottom-[7.6%] left-[13.5%] z-20 transition-all ${canGoPrev ? "hover:-translate-x-[2px] hover:-translate-y-[1px]" : "opacity-[0.28]"}`}
              >
                <img
                  src={diaryArrowPrev}
                  alt=""
                  className="h-[clamp(2.9rem,2.3rem+1vw,4.25rem)] w-[clamp(2.9rem,2.3rem+1vw,4.25rem)] object-contain"
                  draggable={false}
                />
              </button>

              <button
                type="button"
                onClick={handleNext}
                disabled={!canGoNext}
                style={{ marginRight: "-10pt" }}
                className={`absolute bottom-[7.6%] right-[13.2%] z-20 transition-all ${canGoNext ? "hover:translate-x-[2px] hover:-translate-y-[1px]" : "opacity-[0.28]"}`}
              >
                <img
                  src={diaryArrowNext}
                  alt=""
                  className="h-[clamp(2.9rem,2.3rem+1vw,4.25rem)] w-[clamp(2.9rem,2.3rem+1vw,4.25rem)] object-contain"
                  draggable={false}
                />
              </button>
            </>
          ) : null}
        </div>

        <CollectibleInspectOverlay
          open={Boolean(inspectingCollectible)}
          imageSrc={inspectingCollectible?.imageSrc ?? ""}
          clueId={inspectingCollectible?.id}
          description={inspectingCollectible?.description[language] ?? ""}
          actionLabel={inspectingCollectible?.actionLabel[language] ?? ""}
          onConfirm={() => {
            if (inspectingCollectible) {
              handleCollectibleConfirm(inspectingCollectible.id);
            }
          }}
        />
      </div>
    </FocusArea>
  );
};

/**
 * LandingView Component
 * The initial entry point with a full-screen background and a minimalist start button.
 */
const LandingView = ({
  onStart,
  onNewGame,
  openSaves,
  ui,
}: {
  onStart: () => void;
  onNewGame: () => void;
  openSaves: () => void;
  ui: (typeof UI_COPY)[Language];
}) => {
  return (
    <div className="relative flex h-full w-full items-center justify-start overflow-hidden landing-surface-asset">
      <LandingBackdrop />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,3,1,0.44)_0%,rgba(7,3,1,0.22)_18%,rgba(7,3,1,0.08)_34%,rgba(7,3,1,0.04)_48%,rgba(7,3,1,0.24)_100%)]" />

      <div className="relative z-20 ml-[6.3%] flex max-w-[42vw] flex-col items-start" style={{ marginTop: "120pt" }}>
        <motion.img
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.65, ease: "easeOut" }}
          src={afterlandLogo}
          alt="Afterland"
          className="w-[clamp(14rem,22vw,31rem)] max-w-none select-none"
          draggable={false}
        />

        <div className="mt-[clamp(1.55rem,3.2vh,2.6rem)] ml-[0.1rem] flex flex-col items-start gap-[clamp(0.72rem,1.75vh,1.3rem)]">
          <LandingMenuButton label={ui.landing.startGame} onClick={onStart} delay={0.18} />
          <LandingMenuButton label={ui.landing.newGame} onClick={onNewGame} delay={0.28} />
          <LandingMenuButton label={ui.landing.saves} onClick={openSaves} delay={0.38} />
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const exhibitionMode = readExhibitionMode();
  const exhibitionInitialChapter = exhibitionMode ? findNarrativeChapterById(exhibitionMode.chapterId) ?? chapters[0] : chapters[0];
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const [bodyTextSize, setBodyTextSize] = useState<BodyTextSize>(() => readStoredBodyTextSize());
  const [musicEnabled, setMusicEnabled] = useState(() => readStoredBoolean(MUSIC_ENABLED_STORAGE_KEY, true));
  const [musicVolume, setMusicVolume] = useState(() => readStoredVolume());
  const [sfxEnabled, setSfxEnabled] = useState(() => readStoredBoolean(SFX_ENABLED_STORAGE_KEY, true));
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(() => readStoredBoolean(AUTO_PLAY_ENABLED_STORAGE_KEY, false));
  const [autoPlaySpeed, setAutoPlaySpeed] = useState(() => readStoredAutoPlaySpeed());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavePanelOpen, setIsSavePanelOpen] = useState(false);
  const [isNewGamePromptOpen, setIsNewGamePromptOpen] = useState(false);
  const [isExhibitionNoticeVisible, setIsExhibitionNoticeVisible] = useState(false);
  const [saveSlots, setSaveSlots] = useState<PlaythroughSaveSlot[]>(() => readPlaythroughSaveSlots());
  const [view, setView] = useState<AppView>(() => (exhibitionMode ? "detailed" : "landing"));
  const [activeTab, setActiveTab] = useState<DesktopPanelId>("artifacts");
  const [isEchoing, setIsEchoing] = useState(false);
  const [activeChapter, setActiveChapter] = useState<ChapterContent>(exhibitionInitialChapter);
  const [memoryStartRequest, setMemoryStartRequest] = useState<MemoryStartRequest | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgmFadeFrameRef = useRef<number | null>(null);
  const bgmShouldPlayRef = useRef(musicEnabled);
  const bgmVolumeRef = useRef(musicEnabled ? musicVolume / 100 : 0);
  const exhibitionNoticeTimeoutRef = useRef<number | null>(null);
  const shouldPlayBgm = musicEnabled && !(view === "detailed" && activeTab === "artifacts" && isEchoing);
  const chapterMusicSrc = CHAPTER_MUSIC_BY_CHAPTER_ID[activeChapter.id];
  const shouldPlayChapterMusic =
    musicEnabled && view === "detailed" && activeTab === "artifacts" && isEchoing && Boolean(chapterMusicSrc);
  const isExhibitionMode = Boolean(exhibitionMode);

  const showExhibitionLockedNotice = useCallback(() => {
    if (!isExhibitionMode) {
      return;
    }

    setIsExhibitionNoticeVisible(false);
    if (exhibitionNoticeTimeoutRef.current !== null) {
      window.clearTimeout(exhibitionNoticeTimeoutRef.current);
      exhibitionNoticeTimeoutRef.current = null;
    }

    window.requestAnimationFrame(() => {
      setIsExhibitionNoticeVisible(true);
    });

    exhibitionNoticeTimeoutRef.current = window.setTimeout(() => {
      exhibitionNoticeTimeoutRef.current = null;
      setIsExhibitionNoticeVisible(false);
    }, 2400);
  }, [isExhibitionMode]);

  useEffect(() => {
    storageSetItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    storageSetItem(BODY_TEXT_SIZE_STORAGE_KEY, bodyTextSize);
  }, [bodyTextSize]);

  useEffect(() => {
    document.body.dataset.language = language;
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  }, [language]);

  useEffect(() => {
    return () => {
      if (exhibitionNoticeTimeoutRef.current !== null) {
        window.clearTimeout(exhibitionNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    storageSetItem(MUSIC_ENABLED_STORAGE_KEY, String(musicEnabled));
  }, [musicEnabled]);

  useEffect(() => {
    storageSetItem(MUSIC_VOLUME_STORAGE_KEY, String(musicVolume));
  }, [musicVolume]);

  useEffect(() => {
    storageSetItem(SFX_ENABLED_STORAGE_KEY, String(sfxEnabled));
  }, [sfxEnabled]);

  useEffect(() => {
    storageSetItem(AUTO_PLAY_ENABLED_STORAGE_KEY, String(autoPlayEnabled));
  }, [autoPlayEnabled]);

  useEffect(() => {
    storageSetItem(AUTO_PLAY_SPEED_STORAGE_KEY, String(autoPlaySpeed));
  }, [autoPlaySpeed]);

  useEffect(() => {
    bgmShouldPlayRef.current = shouldPlayBgm;
    bgmVolumeRef.current = musicEnabled ? musicVolume / 100 : 0;
  }, [musicEnabled, musicVolume, shouldPlayBgm]);

  useEffect(() => {
    const audio = new Audio(`${import.meta.env.BASE_URL}main-bgm.mp3`);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    bgmAudioRef.current = audio;

    const stopFade = () => {
      if (bgmFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(bgmFadeFrameRef.current);
        bgmFadeFrameRef.current = null;
      }
    };

    const fadeTo = (targetVolume: number, duration: number, pauseAfterFade = false) => {
      const currentAudio = bgmAudioRef.current;
      if (!currentAudio) return;

      stopFade();

      const startVolume = currentAudio.volume;
      const startTime = window.performance.now();

      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        currentAudio.volume = startVolume + (targetVolume - startVolume) * progress;

        if (progress < 1) {
          bgmFadeFrameRef.current = window.requestAnimationFrame(step);
          return;
        }

        bgmFadeFrameRef.current = null;
        currentAudio.volume = targetVolume;

        if (pauseAfterFade && targetVolume <= 0.001) {
          currentAudio.pause();
        }
      };

      bgmFadeFrameRef.current = window.requestAnimationFrame(step);
    };

    const tryPlay = async () => {
      const currentAudio = bgmAudioRef.current;
      if (!currentAudio || !bgmShouldPlayRef.current) return;

      if (currentAudio.paused) {
        try {
          await currentAudio.play();
        } catch {
          return;
        }
      }

      fadeTo(bgmVolumeRef.current, 700, false);
    };

    const unlockPlayback = () => {
      void tryPlay();
    };

    void tryPlay();
    window.addEventListener("pointerdown", unlockPlayback);
    window.addEventListener("keydown", unlockPlayback);
    window.addEventListener("touchstart", unlockPlayback, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", unlockPlayback);
      window.removeEventListener("keydown", unlockPlayback);
      window.removeEventListener("touchstart", unlockPlayback);
      stopFade();
      audio.pause();
      audio.currentTime = 0;
      bgmAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = bgmAudioRef.current;
    if (!audio) return;

    const stopFade = () => {
      if (bgmFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(bgmFadeFrameRef.current);
        bgmFadeFrameRef.current = null;
      }
    };

    const fadeTo = (targetVolume: number, duration: number, pauseAfterFade = false) => {
      stopFade();

      const startVolume = audio.volume;
      const startTime = window.performance.now();

      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        audio.volume = startVolume + (targetVolume - startVolume) * progress;

        if (progress < 1) {
          bgmFadeFrameRef.current = window.requestAnimationFrame(step);
          return;
        }

        bgmFadeFrameRef.current = null;
        audio.volume = targetVolume;

        if (pauseAfterFade && targetVolume <= 0.001) {
          audio.pause();
        }
      };

      bgmFadeFrameRef.current = window.requestAnimationFrame(step);
    };

    if (shouldPlayBgm) {
      const resumePlayback = async () => {
        if (audio.paused) {
          audio.volume = 0;
          try {
            await audio.play();
          } catch {
            return;
          }
        }

        fadeTo(musicVolume / 100, 700, false);
      };

      void resumePlayback();
      return;
    }

    if (!audio.paused) {
      fadeTo(0, 850, true);
    }
  }, [musicVolume, shouldPlayBgm]);

  const ui = UI_COPY[language];
  const bodyTextSizePt = BODY_TEXT_SIZE_PT[bodyTextSize];

  const applyGameSaveState = (savedState: GameSaveState | null) => {
    if (!savedState) {
      setActiveTab("artifacts");
      setActiveChapter(chapters[0]);
      setIsEchoing(false);
      setView("home");
      return;
    }

    setActiveTab(savedState.activeTab);
    setActiveChapter(findNarrativeChapterById(savedState.activeChapterId) ?? chapters[0]);
    setIsEchoing(savedState.view === "detailed" ? savedState.isEchoing : false);
    setView(savedState.view);
  };

  useEffect(() => {
    if (isExhibitionMode) {
      return;
    }

    if (view === "landing") {
      return;
    }

    const saveState: GameSaveState = {
      view,
      activeTab,
      activeChapterId: activeChapter.id,
      isEchoing,
    };

    storageSetItem(GAME_SAVE_STORAGE_KEY, JSON.stringify(saveState));
  }, [activeChapter.id, activeTab, isEchoing, isExhibitionMode, view]);

  const persistCurrentNonLandingState = () => {
    if (view === "landing") {
      return;
    }

    const saveState: GameSaveState = {
      view,
      activeTab,
      activeChapterId: activeChapter.id,
      isEchoing,
    };

    storageSetItem(GAME_SAVE_STORAGE_KEY, JSON.stringify(saveState));
  };

  const saveCurrentPlaythroughToSlot = () => {
    persistCurrentNonLandingState();

    const snapshot = collectGameplayStorageSnapshot();
    if (Object.keys(snapshot).length === 0) {
      return false;
    }

    const newSlot: PlaythroughSaveSlot = {
      id: `${Date.now()}-${Math.round(Math.random() * 100000)}`,
      savedAt: new Date().toISOString(),
      storage: snapshot,
    };
    const nextSlots = [newSlot, ...readPlaythroughSaveSlots()].slice(0, MAX_PLAYTHROUGH_SAVE_SLOTS);

    writePlaythroughSaveSlots(nextSlots);
    setSaveSlots(nextSlots);

    return true;
  };

  const startFreshGame = () => {
    setIsSettingsOpen(false);
    setIsSavePanelOpen(false);
    setIsNewGamePromptOpen(false);
    setActiveTab("artifacts");
    setIsEchoing(false);
    setActiveChapter(chapters[0]);
    setMemoryStartRequest(null);
    clearAllGameplayProgress();
    setView("home");
  };

  const handleContinueGame = () => {
    setIsSettingsOpen(false);
    setIsSavePanelOpen(false);
    applyGameSaveState(readGameSaveState());
  };

  const handleNewGame = () => {
    setIsSettingsOpen(false);
    setIsSavePanelOpen(false);

    const snapshot = collectGameplayStorageSnapshot();
    if (Object.keys(snapshot).length === 0) {
      startFreshGame();
      return;
    }

    setIsNewGamePromptOpen(true);
  };

  const handleSaveAndStartNewGame = () => {
    saveCurrentPlaythroughToSlot();
    startFreshGame();
  };

  const handleLoadSaveSlot = (slotId: string) => {
    const slot = saveSlots.find((item) => item.id === slotId);
    if (!slot) return;

    restoreGameplayStorageSnapshot(slot.storage);
    setIsSavePanelOpen(false);
    setIsSettingsOpen(false);
    applyGameSaveState(readGameSaveState());
  };

  const handleStartItemMemory = (chapterId: string) => {
    const memoryChapter = findNarrativeChapterById(chapterId);
    if (!memoryChapter) return;

    setIsSettingsOpen(false);
    setActiveTab("artifacts");
    setActiveChapter(memoryChapter);
    setIsEchoing(true);
    setMemoryStartRequest({ chapterId, requestId: Date.now() });
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#120905]">
      <ChapterMusicController src={chapterMusicSrc} shouldPlay={shouldPlayChapterMusic} volume={musicVolume / 100} />
      <div
        className="relative h-full w-full"
        style={{ minWidth: `${MIN_STAGE_WIDTH}px`, minHeight: `${MIN_STAGE_HEIGHT}px` }}
      >
      <AnimatePresence mode="wait">
        {view === "landing" ? (
          <motion.div
            key="landing-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={PAGE_FADE_TRANSITION}
            className="w-full h-full"
          >
            <LandingView
              onStart={handleContinueGame}
              onNewGame={handleNewGame}
              openSaves={() => {
                setIsSettingsOpen(false);
                setIsSavePanelOpen(true);
              }}
              ui={ui}
            />
          </motion.div>
        ) : view === "home" ? (
          <motion.div
            key="home-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={PAGE_FADE_TRANSITION}
            className="w-full h-full"
          >
            <HomeView
              onNavigate={(dest) => {
                setIsSettingsOpen(false);
                setActiveTab(dest);
                setView("detailed");
              }}
              onBackToLanding={() => {
                setIsSettingsOpen(false);
                setView("landing");
              }}
              journalLabel={ui.home.journalArchive}
              itemLabel={ui.home.relic}
              codexLabel={ui.home.codex}
              mapLabel={ui.home.map}
              backLabel={ui.home.backToLanding}
            />
          </motion.div>
        ) : (
          <motion.div
            key="detailed-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={PAGE_FADE_TRANSITION}
            className="w-full h-full"
          >
            <DesktopContainer
              className="bg-[#120905]"
              contentClassName="px-0 py-0"
              showFlame={false}
              style={{
                backgroundImage: `url(${diarySceneBg})`,
                backgroundPosition: "center center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "cover",
              }}
            >
              {!isExhibitionMode ? (
                <div className="absolute left-4 top-4 z-50 sm:left-6 sm:top-6 lg:left-8 lg:top-8">
                  <CornerActionButton
                    label={ui.detail.backToHub}
                    onClick={() => {
                      setIsSettingsOpen(false);
                      setView("home");
                    }}
                  />
                </div>
              ) : null}

              <div
                className={`absolute inset-0 transition-opacity duration-500 ease-out ${
                  activeTab === "artifacts" ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
              >
                <DiaryArtifactView
                  language={language}
                  ui={ui}
                  activeChapter={activeChapter}
                  setActiveChapter={setActiveChapter}
                  isEchoing={isEchoing}
                  setIsEchoing={setIsEchoing}
                  bodyTextSizePt={bodyTextSizePt}
                  autoPlayEnabled={autoPlayEnabled}
                  autoPlaySpeed={autoPlaySpeed}
                  memoryStartRequest={memoryStartRequest}
                  exhibitionMode={exhibitionMode}
                  onLockedInteraction={showExhibitionLockedNotice}
                />
              </div>

              <div
                className={`absolute inset-0 transition-opacity duration-500 ease-out ${
                  activeTab === "artifacts" ? "pointer-events-none opacity-0" : "opacity-100"
                }`}
              >
                {activeTab === "items" ? (
                  <ItemArchivePanel language={language} onStartMemory={handleStartItemMemory} />
                ) : activeTab === "codex" ? (
                  <CodexArchivePanel language={language} />
                ) : activeTab === "map" ? (
                  <MapArchivePanel language={language} />
                ) : (
                  <EmptyDesktopPanel />
                )}
              </div>

              {!isExhibitionMode ? (
                <DesktopQuickMenu
                  activeTab={activeTab}
                  language={language}
                  onSelect={(panel) => {
                    setIsSettingsOpen(false);
                    setActiveTab(panel);
                  }}
                />
              ) : null}
            </DesktopContainer>
          </motion.div>
        )}
      </AnimatePresence>

      <GlobalSettingsControl
        open={isSettingsOpen}
        onOpen={() => setIsSettingsOpen(true)}
        onClose={() => setIsSettingsOpen(false)}
        language={language}
        setLanguage={setLanguage}
        bodyTextSize={bodyTextSize}
        setBodyTextSize={setBodyTextSize}
        musicEnabled={musicEnabled}
        setMusicEnabled={setMusicEnabled}
        musicVolume={musicVolume}
        setMusicVolume={setMusicVolume}
        sfxEnabled={sfxEnabled}
        setSfxEnabled={setSfxEnabled}
        autoPlayEnabled={autoPlayEnabled}
        setAutoPlayEnabled={setAutoPlayEnabled}
        autoPlaySpeed={autoPlaySpeed}
        setAutoPlaySpeed={setAutoPlaySpeed}
        ui={ui}
      />
      <SaveSlotsPanel
        open={isSavePanelOpen}
        onClose={() => setIsSavePanelOpen(false)}
        onLoad={handleLoadSaveSlot}
        slots={saveSlots}
        language={language}
        ui={ui.saves}
      />
      <NewGamePrompt
        open={isNewGamePromptOpen}
        onSaveAndStart={handleSaveAndStartNewGame}
        onStartWithoutSave={startFreshGame}
        onCancel={() => setIsNewGamePromptOpen(false)}
        ui={ui.saves}
      />
      <ExhibitionNotice visible={isExhibitionNoticeVisible} />
      </div>
    </div>
  );
}
