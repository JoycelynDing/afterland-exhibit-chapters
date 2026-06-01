import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Story } from "inkjs";
import { Sparkles } from "lucide-react";
import { useStory } from "./StoryContext";
import {storageGetItem, storageRemoveItem, storageSetItem} from "../../utils/safeStorage";

interface ChoiceOption {
  index: number;
  text: string;
}

type InlineImageLayout = "column" | "spread";

interface InlineImageAsset {
  src: string;
  layout?: InlineImageLayout;
}

interface InlineImageInsertion {
  imageId: string;
  textIncludes: string;
  position: "before" | "after";
}

interface InlineImageConfig {
  assets: Record<string, InlineImageAsset>;
  insertions?: InlineImageInsertion[];
}

interface CollectibleTrigger {
  id: string;
  textIncludes: string;
}

interface HistoryElement {
  id: string;
  type: "text" | "choice" | "choiceGroup" | "image";
  content: string;
  displayedLength?: number;
  isTyping?: boolean;
  isNew?: boolean;
  options?: ChoiceOption[];
  selectedChoiceIndex?: number;
  imageId?: string;
  imageSrc?: string;
  imageLayout?: InlineImageLayout;
}

interface JournalTutorialCopy {
  advance: string;
  choice: string;
  nextPage: string;
  prevPage: string;
}

interface JournalPageCopy {
  choicePrefix: string;
  continueHint: string;
  narrativeEnded: string;
  tutorial: JournalTutorialCopy;
}

type TutorialStepId = keyof JournalTutorialCopy;
type TutorialSeenState = Record<TutorialStepId, boolean>;

interface TutorialTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type JournalFlowItem =
  | { id: string; kind: "history"; item: HistoryElement }
  | { id: string; kind: "choices" }
  | { id: string; kind: "hint" }
  | { id: string; kind: "end" };

interface NotebookSpreadControls {
  backLabel: string;
  onExit: () => void;
  prevArrowSrc: string;
  nextArrowSrc: string;
}

interface PersistedReaderSnapshot {
  history: HistoryElement[];
  currentLinesToDisplay: string[];
  lineIndex: number;
  currentPageIndex: number;
  unlockedPageIndex?: number;
  typingItemId: string | null;
  selectedChoiceIndex: number | null;
  choicesRevealed?: boolean;
  turnCount: number;
}

interface PersistedInkSnapshot {
  storyStateJson?: string;
}

const createEmptyNotebookPages = (): NotebookPage[] => [
  {
    id: "page-0-empty",
    rows: [{ id: "row-empty-0", kind: "columns", left: [], right: [] }],
  },
];

const findPageIndexByFlowItemId = (pages: NotebookPage[], flowItemId: string | null) => {
  if (!flowItemId) {
    return -1;
  }

  return pages.findIndex((page) =>
    page.rows.some((row) =>
      row.kind === "spread"
        ? row.item.id === flowItemId
        : row.left.some((flowItem) => flowItem.id === flowItemId) ||
          row.right.some((flowItem) => flowItem.id === flowItemId),
    ),
  );
};

interface JournalPageProps {
  ui: JournalPageCopy;
  layout?: "default" | "notebookSpread";
  isActive?: boolean;
  bodyTextSizePt?: number;
  notebookSpreadControls?: NotebookSpreadControls;
  progressStorageKey?: string;
  storyStorageKey?: string;
  onReadComplete?: () => void;
  inlineImageConfig?: InlineImageConfig;
  totalCharacterCount?: number;
  storyJson?: unknown;
  collectibleTriggers?: CollectibleTrigger[];
  collectedCollectibleIds?: string[];
  onCollectibleTrigger?: (id: string) => void;
  isPaused?: boolean;
  onPausedAdvanceAttempt?: () => void;
  autoPlayEnabled?: boolean;
  autoPlaySpeed?: number;
}

interface NotebookColumnsRow {
  id: string;
  kind: "columns";
  left: JournalFlowItem[];
  right: JournalFlowItem[];
}

interface NotebookSpreadRow {
  id: string;
  kind: "spread";
  item: JournalFlowItem;
}

type NotebookRow = NotebookColumnsRow | NotebookSpreadRow;

interface NotebookPage {
  id: string;
  rows: NotebookRow[];
}

const NOTEBOOK_COLUMN_GAP_PX = 64;
const NOTEBOOK_INLINE_SKETCH_WIDTH_PERCENT = 128;
const TYPEWRITER_MIN_STEP_MS = 10;
const TYPEWRITER_MAX_STEP_MS = 68;
const AUTO_PLAY_PARAGRAPH_DELAY_MS = 320;
const CHOICE_RESOLVE_DELAY_MS = 420;
const PAGE_TRANSITION = { duration: 0.34, ease: "easeOut" } as const;
const CHAPTER_EXIT_FADE_MS = 900;
const INLINE_IMAGE_OVERFLOW_TOLERANCE = 0.2;
const createTutorialSeenState = (): TutorialSeenState => ({
  advance: false,
  choice: false,
  nextPage: false,
  prevPage: false,
});
const buildImageMarkerToken = (imageId: string) => `[[IMG:${imageId.toUpperCase()}]]`;
const buildCollectibleMarkerToken = (clueId: string) => `[[CLUE:${clueId.toUpperCase()}]]`;
const countTokenCharacters = (token: string, assets: Record<string, InlineImageAsset>) =>
  resolveInlineImageId(token, assets) || resolveCollectibleMarkerId(token) ? 0 : token.length;
const CHAPTER_BOUNDARY_CHOICE_PATTERN = /翻到下一篇|下一篇日记|开启下一章|进入下一章|下一章|next\s+(?:chapter|entry)/i;

const ScreenEdgeProgress = ({
  progress,
  animateQuickly,
}: {
  progress: number;
  animateQuickly: boolean;
}) => {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const segmentProgress = clampedProgress * 3;
  const leftProgress = Math.min(1, segmentProgress);
  const topProgress = Math.min(1, Math.max(0, segmentProgress - 1));
  const rightProgress = Math.min(1, Math.max(0, segmentProgress - 2));
  const transition = { duration: animateQuickly ? 0.18 : 0.32, ease: "easeOut" as const };
  const content = (
    <div
      aria-hidden="true"
      className="pointer-events-none z-[120] overflow-hidden"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh" }}
    >
      <motion.div
        initial={false}
        animate={{ scaleY: leftProgress, opacity: leftProgress > 0.001 ? 1 : 0 }}
        transition={transition}
        style={{ transformOrigin: "bottom center" }}
        className="absolute bottom-0 left-0 top-0 w-[5px] rounded-full bg-[#f7edd8] shadow-[0_0_10px_rgba(255,244,218,0.92),0_0_22px_rgba(255,244,218,0.5)]"
      />
      <motion.div
        initial={false}
        animate={{ scaleX: topProgress, opacity: topProgress > 0.001 ? 1 : 0 }}
        transition={transition}
        style={{ transformOrigin: "left center" }}
        className="absolute left-0 right-0 top-0 h-[5px] rounded-full bg-[#f7edd8] shadow-[0_0_10px_rgba(255,244,218,0.92),0_0_22px_rgba(255,244,218,0.5)]"
      />
      <motion.div
        initial={false}
        animate={{ scaleY: rightProgress, opacity: rightProgress > 0.001 ? 1 : 0 }}
        transition={transition}
        style={{ transformOrigin: "top center" }}
        className="absolute bottom-0 right-0 top-0 w-[5px] rounded-full bg-[#f7edd8] shadow-[0_0_10px_rgba(255,244,218,0.92),0_0_22px_rgba(255,244,218,0.5)]"
      />
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
};

const isChapterBoundaryChoiceText = (text: string) => CHAPTER_BOUNDARY_CHOICE_PATTERN.test(text.trim());

const TUTORIAL_TARGETS: Record<
  TutorialStepId,
  {
    targetClassName: string;
    bubbleClassName: string;
    allowsPassThrough?: boolean;
  }
> = {
  advance: {
    targetClassName: "left-[13.5%] top-[17%] h-[70%] w-[75.2%]",
    bubbleClassName: "left-1/2 top-[73%] -translate-x-1/2",
  },
  choice: {
    targetClassName: "left-[14.5%] top-[24%] h-[42%] w-[38%]",
    bubbleClassName: "left-[28%] top-[21%] -translate-x-1/2",
    allowsPassThrough: true,
  },
  nextPage: {
    targetClassName: "bottom-[5.8%] right-[11.2%] h-[5.9rem] w-[5.9rem]",
    bubbleClassName: "right-[18%] bottom-[17%]",
  },
  prevPage: {
    targetClassName: "bottom-[5.8%] left-[12.2%] h-[5.9rem] w-[5.9rem]",
    bubbleClassName: "left-[18%] bottom-[17%]",
  },
};

interface TutorialOverlayProps {
  step: TutorialStepId;
  copy: JournalTutorialCopy;
  targetRect?: TutorialTargetRect | null;
  onAdvance: () => void;
  onNextPage: () => void;
  onPrevPage: () => void;
}

const TutorialOverlay = ({ step, copy, targetRect, onAdvance, onNextPage, onPrevPage }: TutorialOverlayProps) => {
  const target = TUTORIAL_TARGETS[step];
  const dynamicTargetStyle = targetRect
    ? ({
        left: `${targetRect.left}px`,
        top: `${targetRect.top}px`,
        width: `${targetRect.width}px`,
        height: `${targetRect.height}px`,
      } as React.CSSProperties)
    : undefined;
  const dynamicBubbleStyle =
    step === "choice" && targetRect
      ? ({
          left: `${Math.max(18, targetRect.left + 8)}px`,
          top: `${Math.max(18, targetRect.top - 104)}px`,
        } as React.CSSProperties)
      : undefined;
  const dimLayerStyle =
    targetRect && step === "choice"
      ? ({
          WebkitMaskImage: `radial-gradient(ellipse ${Math.max(targetRect.width * 0.62, 160)}px ${Math.max(
            targetRect.height * 0.72,
            84,
          )}px at ${targetRect.left + targetRect.width / 2}px ${
            targetRect.top + targetRect.height / 2
          }px, transparent 0%, transparent 38%, rgba(0,0,0,0.45) 58%, black 100%)`,
          maskImage: `radial-gradient(ellipse ${Math.max(targetRect.width * 0.62, 160)}px ${Math.max(
            targetRect.height * 0.72,
            84,
          )}px at ${targetRect.left + targetRect.width / 2}px ${
            targetRect.top + targetRect.height / 2
          }px, transparent 0%, transparent 38%, rgba(0,0,0,0.45) 58%, black 100%)`,
        } as React.CSSProperties)
      : undefined;
  const handleGuidedClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (step === "advance") {
      onAdvance();
      return;
    }

    if (step === "nextPage") {
      onNextPage();
      return;
    }

    if (step === "prevPage") {
      onPrevPage();
    }
  };

  return (
    <motion.div
      className={`absolute inset-0 z-[80] ${target.allowsPassThrough ? "pointer-events-none" : "pointer-events-auto"}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.38, ease: "easeOut" }}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[#100905]/54"
        style={dimLayerStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
      />
      <motion.div
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-[999px] ${
          targetRect ? "" : target.targetClassName
        }`}
        style={{
          ...dynamicTargetStyle,
          background:
            "radial-gradient(ellipse at center, rgba(255, 235, 190, 0.6) 0%, rgba(240, 191, 116, 0.24) 48%, rgba(240, 191, 116, 0) 76%)",
          boxShadow: "0 0 34px 14px rgba(231, 178, 98, 0.26)",
          filter: "blur(4px)",
          transform: "scale(1.04)",
        }}
        animate={{ opacity: [0.78, 1, 0.78] }}
        transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut" }}
      />

      {!target.allowsPassThrough && (
        <button
          type="button"
          aria-label={copy[step]}
          onClick={handleGuidedClick}
          className={`absolute rounded-[2rem] bg-transparent ${targetRect ? "" : target.targetClassName}`}
          style={dynamicTargetStyle}
        />
      )}

      <motion.div
        className={`pointer-events-none absolute max-w-[22rem] rounded-[1rem] border border-[#e7c894]/35 bg-[#1d130b]/78 px-[1rem] py-[0.78rem] font-chinese text-[#f3dec0] shadow-[0_18px_42px_rgba(0,0,0,0.42)] backdrop-blur-[3px] ${
          dynamicBubbleStyle ? "" : target.bubbleClassName
        }`}
        style={dynamicBubbleStyle}
        initial={{ y: 6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.34, ease: "easeOut" }}
      >
        <div className="text-[0.98rem] leading-[1.65] tracking-[0.08em]">{copy[step]}</div>
      </motion.div>
    </motion.div>
  );
};

const countRemainingCharactersFromStoryState = (storyJson: unknown, storyStateJson: string) => {
  const simulateRemaining = (storyInstance: Story): number => {
    let total = 0;

    while (storyInstance.canContinue) {
      const line = storyInstance.Continue().trim();
      total += line.length;
    }

    if (storyInstance.currentChoices.length === 0) {
      return total;
    }

    if (storyInstance.currentChoices.every((choice) => isChapterBoundaryChoiceText(choice.text))) {
      return total;
    }

    const branchTotals = storyInstance.currentChoices.map((_, choiceIndex) => {
      const branchStory = new Story(storyJson);
      branchStory.state.LoadJson(storyInstance.state.ToJson());
      branchStory.ChooseChoiceIndex(choiceIndex);
      return simulateRemaining(branchStory);
    });

    return total + Math.max(...branchTotals, 0);
  };

  const storyClone = new Story(storyJson);
  storyClone.state.LoadJson(storyStateJson);
  return simulateRemaining(storyClone);
};

const resolveInlineImageId = (rawLine: string, assets: Record<string, InlineImageAsset>) => {
  const trimmed = rawLine.trim();
  const markerMatch =
    trimmed.match(/^\[\[\s*IMG\s*:\s*([A-Za-z0-9_-]+)\s*\]\]$/i) ??
    trimmed.match(/^\[\[\s*([AB]\d{3,})\s*\]\]$/i) ??
    trimmed.match(/^\[\s*([AB]\d{3,})\s*\]$/i) ??
    trimmed.match(/^([AB]\d{3,})$/i) ??
    trimmed.match(/^(?:图片|IMG|IMAGE)\s*[:：]?\s*([A-Za-z0-9_-]+)$/i);

  if (!markerMatch) {
    return null;
  }

  const normalizedId = markerMatch[1].toUpperCase();
  return assets[normalizedId] ? normalizedId : null;
};

const resolveCollectibleMarkerId = (rawLine: string) => {
  const trimmed = rawLine.trim();
  const markerMatch =
    trimmed.match(/^\[\[\s*CLUE\s*:\s*(C\d{3,})\s*\]\]$/i) ??
    trimmed.match(/^\[\[\s*(C\d{3,})\s*\]\]$/i) ??
    trimmed.match(/^\[\s*(C\d{3,})\s*\]$/i) ??
    trimmed.match(/^(C\d{3,})$/i) ??
    trimmed.match(/^(?:线索|CLUE)\s*[:：]?\s*(C\d{3,})$/i);

  return markerMatch ? markerMatch[1].toUpperCase() : null;
};

const isCollectibleMarkerToken = (token: string) => Boolean(resolveCollectibleMarkerId(token));

const resolveStoryLinesWithInlineImages = (
  lines: string[],
  assets: Record<string, InlineImageAsset>,
  inlineImageConfig?: InlineImageConfig,
) => {
  const storyLinesWithImages: string[] = [];

  lines.filter(Boolean).forEach((line) => {
    const markerImageId = resolveInlineImageId(line, assets);
    if (markerImageId) {
      storyLinesWithImages.push(buildImageMarkerToken(markerImageId));
      return;
    }

    const markerCollectibleId = resolveCollectibleMarkerId(line);
    if (markerCollectibleId) {
      storyLinesWithImages.push(buildCollectibleMarkerToken(markerCollectibleId));
      return;
    }

    const trimmedLine = line.trim();
    inlineImageConfig?.insertions?.forEach((insertion) => {
      const normalizedImageId = insertion.imageId.toUpperCase();
      if (insertion.position === "before" && trimmedLine.includes(insertion.textIncludes) && assets[normalizedImageId]) {
        storyLinesWithImages.push(buildImageMarkerToken(normalizedImageId));
      }
    });

    storyLinesWithImages.push(line);

    inlineImageConfig?.insertions?.forEach((insertion) => {
      const normalizedImageId = insertion.imageId.toUpperCase();
      if (insertion.position === "after" && trimmedLine.includes(insertion.textIncludes) && assets[normalizedImageId]) {
        storyLinesWithImages.push(buildImageMarkerToken(normalizedImageId));
      }
    });
  });

  return storyLinesWithImages;
};

const isSpreadFlowItem = (flowItem: JournalFlowItem) =>
  flowItem.kind === "history" && flowItem.item.type === "image" && flowItem.item.imageLayout === "spread";

const isColumnImageFlowItem = (flowItem: JournalFlowItem) =>
  flowItem.kind === "history" && flowItem.item.type === "image" && flowItem.item.imageLayout !== "spread";

const buildNotebookPages = (
  flowItems: JournalFlowItem[],
  itemHeights: number[],
  columnHeight: number,
  blockGapPx: number,
) => {
  let pageSequence = 0;
  let rowSequence = 0;
  const pages: NotebookPage[] = [];
  let currentPageRows: NotebookRow[] = [];
  let pageUsedHeight = 0;
  let pageHasRows = false;
  let currentColumn: "left" | "right" = "left";
  let currentColumns: {
    row: NotebookColumnsRow;
    leftHeight: number;
    rightHeight: number;
    hasContent: boolean;
  } = {
    row: { id: `row-${rowSequence++}`, kind: "columns", left: [], right: [] },
    leftHeight: 0,
    rightHeight: 0,
    hasContent: false,
  };

  const getColumnsRowHeight = (leftHeight = currentColumns.leftHeight, rightHeight = currentColumns.rightHeight) =>
    Math.max(leftHeight, rightHeight);

  const getTotalHeightWithCurrentColumns = (
    leftHeight = currentColumns.leftHeight,
    rightHeight = currentColumns.rightHeight,
    hasContent = currentColumns.hasContent,
  ) => {
    if (!hasContent) {
      return pageUsedHeight;
    }

    const rowHeight = getColumnsRowHeight(leftHeight, rightHeight);
    return pageUsedHeight + rowHeight + (pageHasRows ? blockGapPx : 0);
  };

  const resetCurrentColumns = () => {
    currentColumns = {
      row: { id: `row-${rowSequence++}`, kind: "columns", left: [], right: [] },
      leftHeight: 0,
      rightHeight: 0,
      hasContent: false,
    };
    currentColumn = "left";
  };

  const finalizeCurrentColumns = () => {
    if (!currentColumns.hasContent) {
      return;
    }

    currentPageRows.push(currentColumns.row);
    pageUsedHeight = getTotalHeightWithCurrentColumns();
    pageHasRows = true;
    resetCurrentColumns();
  };

  const flushCurrentPage = () => {
    finalizeCurrentColumns();
    pages.push({
      id: `page-${pageSequence++}`,
      rows: currentPageRows.length
        ? currentPageRows
        : [{ id: `row-${rowSequence++}`, kind: "columns", left: [], right: [] }],
    });
    currentPageRows = [];
    pageUsedHeight = 0;
    pageHasRows = false;
    resetCurrentColumns();
  };

  const getAvailableColumnHeight = () => Math.max(0, columnHeight - pageUsedHeight - (pageHasRows ? blockGapPx : 0));

  const tryPlaceInColumn = (flowItem: JournalFlowItem, itemHeight: number, column: "left" | "right") => {
    const currentHeight = column === "left" ? currentColumns.leftHeight : currentColumns.rightHeight;
    const nextHeight = currentHeight === 0 ? itemHeight : currentHeight + blockGapPx + itemHeight;
    const overflow = nextHeight - getAvailableColumnHeight();
    const fits =
      overflow <= 0 ||
      (isColumnImageFlowItem(flowItem) &&
        (currentHeight === 0 || overflow <= Math.max(itemHeight * INLINE_IMAGE_OVERFLOW_TOLERANCE, 1)));

    if (!fits) {
      return false;
    }

    currentColumns.row[column].push(flowItem);
    currentColumns.hasContent = true;

    if (column === "left") {
      currentColumns.leftHeight = nextHeight;
    } else {
      currentColumns.rightHeight = nextHeight;
    }

    return true;
  };

  const placeSpreadItem = (flowItem: JournalFlowItem, itemHeight: number) => {
    const priorHeight = getTotalHeightWithCurrentColumns();
    const totalWithSpread = priorHeight + itemHeight + (priorHeight > 0 ? blockGapPx : 0);

    if (totalWithSpread > columnHeight && priorHeight > 0) {
      flushCurrentPage();
    }

    finalizeCurrentColumns();

    currentPageRows.push({
      id: `row-${rowSequence++}`,
      kind: "spread",
      item: flowItem,
    });
    pageUsedHeight += itemHeight + (pageHasRows ? blockGapPx : 0);
    pageHasRows = true;
    currentColumn = "left";
  };

  flowItems.forEach((flowItem, index) => {
    const itemHeight = itemHeights[index] ?? 0;

    if (isSpreadFlowItem(flowItem)) {
      placeSpreadItem(flowItem, itemHeight);
      return;
    }

    if (tryPlaceInColumn(flowItem, itemHeight, currentColumn)) {
      return;
    }

    if (currentColumn === "left") {
      currentColumn = "right";
      if (tryPlaceInColumn(flowItem, itemHeight, "right")) {
        return;
      }
    }

    flushCurrentPage();
    tryPlaceInColumn(flowItem, itemHeight, "left");
  });

  flushCurrentPage();
  return pages;
};

const dedupeAdjacentHistoryItems = (items: HistoryElement[]) => {
  if (items.length <= 1) {
    return items;
  }

  return items.filter((item, index, source) => {
    const previousItem = source[index - 1];

    if (!previousItem) {
      return true;
    }

    return !(
      item.type === "text" &&
      previousItem.type === "text" &&
      item.content === previousItem.content
    );
  });
};

/**
 * JournalPage Component
 * Renders Ink story text and choices with continuous flow and traditional Chinese formatting.
 */
export const JournalPage = ({
  ui,
  layout = "default",
  isActive = true,
  bodyTextSizePt = 12,
  notebookSpreadControls,
  progressStorageKey,
  storyStorageKey,
  onReadComplete,
  inlineImageConfig,
  totalCharacterCount = 1,
  storyJson,
  collectibleTriggers,
  collectedCollectibleIds = [],
  onCollectibleTrigger,
  isPaused = false,
  onPausedAdvanceAttempt,
  autoPlayEnabled = false,
  autoPlaySpeed = 62,
}: JournalPageProps) => {
  const { currentText, currentChoices, selectChoice, isEnded, turnCount, story } = useStory();
  const [history, setHistory] = useState<HistoryElement[]>([]);
  const [currentLinesToDisplay, setCurrentLinesToDisplay] = useState<string[]>([]);
  const [lineIndex, setLineIndex] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [unlockedPageIndex, setUnlockedPageIndex] = useState(0);
  const [notebookPages, setNotebookPages] = useState<NotebookPage[]>(() => createEmptyNotebookPages());
  const defaultScrollRef = useRef<HTMLDivElement>(null);
  const notebookBodyRef = useRef<HTMLDivElement>(null);
  const notebookMeasureRef = useRef<HTMLDivElement>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [typingItemId, setTypingItemId] = useState<string | null>(null);
  const [pendingRevealItemId, setPendingRevealItemId] = useState<string | null>(null);
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState<number | null>(null);
  const [hoveredChoiceIndex, setHoveredChoiceIndex] = useState<number | null>(null);
  const [hideActiveChoices, setHideActiveChoices] = useState(false);
  const [choicesRevealed, setChoicesRevealed] = useState(false);
  const [tutorialEnabled, setTutorialEnabled] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<TutorialStepId | null>(null);
  const [tutorialSeen, setTutorialSeen] = useState<TutorialSeenState>(createTutorialSeenState);
  const [tutorialAwaitingPrevPage, setTutorialAwaitingPrevPage] = useState(false);
  const [tutorialChoiceTargetRect, setTutorialChoiceTargetRect] = useState<TutorialTargetRect | null>(null);
  const [isPageTransitioning, setIsPageTransitioning] = useState(false);
  const [isCompletingChapterExit, setIsCompletingChapterExit] = useState(false);
  const [hasMeasuredNotebookPages, setHasMeasuredNotebookPages] = useState(false);
  const [measuredFlowSignature, setMeasuredFlowSignature] = useState("");
  const [measurementImageVersion, setMeasurementImageVersion] = useState(0);
  const choiceCommitTimeoutRef = useRef<number | null>(null);
  const chapterExitTimeoutRef = useRef<number | null>(null);
  const triggeredCollectibleIdsRef = useRef<Set<string>>(new Set());
  const measuredImageIdsRef = useRef<Set<string>>(new Set());
  const notebookRootRef = useRef<HTMLDivElement>(null);
  const choicesContainerRef = useRef<HTMLDivElement>(null);
  const readerProgressReadyRef = useRef(false);
  const lastInitializedTurnRef = useRef<number | null>(null);
  const restoredProgressKeyRef = useRef<string | null>(null);
  const restorePageTargetRef = useRef<"snapshot" | "latest">("snapshot");
  const isNotebookSpread = layout === "notebookSpread";
  const choiceSignature = currentChoices.map((choice) => `${choice.index}:${choice.text}`).join("||");
  const notebookParagraphGapPt = bodyTextSizePt * 0.8;
  const notebookParagraphGapPx = notebookParagraphGapPt * (96 / 72);
  const normalizedAutoPlaySpeed = Math.min(100, Math.max(0, autoPlaySpeed));
  const typewriterStepMs =
    TYPEWRITER_MAX_STEP_MS - ((TYPEWRITER_MAX_STEP_MS - TYPEWRITER_MIN_STEP_MS) * normalizedAutoPlaySpeed) / 100;
  const notebookBodyTextStyle = { fontSize: `${bodyTextSizePt}pt`, lineHeight: 1.5 } as const;
  const defaultBodyTextStyle = { fontSize: `${bodyTextSizePt}pt`, lineHeight: 1.5 } as const;
  const inlineImageAssets = useMemo<Record<string, InlineImageAsset>>(
    () =>
      Object.fromEntries(Object.entries(inlineImageConfig?.assets ?? {}).map(([imageId, asset]) => [imageId.toUpperCase(), asset])),
    [inlineImageConfig],
  );
  const inlineImageAssetSignature = useMemo(
    () => Object.keys(inlineImageAssets).map((imageId) => `${imageId}:${inlineImageAssets[imageId]?.src ?? ""}`).join("|"),
    [inlineImageAssets],
  );
  const resolvedStoryLines = useMemo(() => {
    return resolveStoryLinesWithInlineImages(currentText, inlineImageAssets, inlineImageConfig);
  }, [currentText, inlineImageAssets, inlineImageConfig]);

  useEffect(() => {
    measuredImageIdsRef.current.clear();
    setMeasurementImageVersion((version) => version + 1);
  }, [inlineImageAssetSignature]);

  const maybeTriggerCollectible = useCallback(
    (item: HistoryElement | undefined) => {
      if (!item || item.type !== "text" || !collectibleTriggers?.length || !onCollectibleTrigger) {
        return;
      }

      const collectedIds = new Set(collectedCollectibleIds.map((id) => id.toUpperCase()));
      const itemContent = item.content;

      const matchedTrigger = collectibleTriggers.find((trigger) => {
        const normalizedId = trigger.id.toUpperCase();
        return (
          !collectedIds.has(normalizedId) &&
          !triggeredCollectibleIdsRef.current.has(normalizedId) &&
          itemContent.includes(trigger.textIncludes)
        );
      });

      if (!matchedTrigger) {
        return;
      }

      const normalizedId = matchedTrigger.id.toUpperCase();
      triggeredCollectibleIdsRef.current.add(normalizedId);
      onCollectibleTrigger(normalizedId);
    },
    [collectedCollectibleIds, collectibleTriggers, onCollectibleTrigger],
  );

  const getHistoryToken = useCallback(
    (item: HistoryElement) => {
      if (item.type === "text") {
        return item.content;
      }

      if (item.type === "image") {
        const imageId = item.imageId ?? resolveInlineImageId(item.content, inlineImageAssets);
        return imageId ? buildImageMarkerToken(imageId) : null;
      }

      return null;
    },
    [inlineImageAssets],
  );

  const createHistoryItemFromToken = useCallback(
    (token: string, itemId: string, mode: "interactive" | "restored"): HistoryElement => {
      const imageId = resolveInlineImageId(token, inlineImageAssets);

      if (imageId) {
        const asset = inlineImageAssets[imageId];
        return {
          id: itemId,
          type: "image",
          content: buildImageMarkerToken(imageId),
          imageId,
          imageSrc: asset.src,
          imageLayout: asset.layout ?? "column",
          isNew: mode === "interactive",
        };
      }

      return {
        id: itemId,
        type: "text",
        content: token,
        displayedLength: mode === "interactive" && isNotebookSpread ? 0 : token.length,
        isTyping: mode === "interactive" && isNotebookSpread,
        isNew: mode === "interactive",
      };
    },
    [inlineImageAssets, isNotebookSpread],
  );

  const replayHistoryToStoryState = useCallback(
    (targetStoryStateJson: string) => {
      if (!storyJson) {
        return null;
      }

      let itemSequence = 0;
      let visitedNodeCount = 0;
      const visitedStates = new Set<string>();
      const maxVisitedNodes = 280;
      const maxChoiceDepth = 80;

      const makeRestoredItems = (tokens: string[]) =>
        tokens
          .filter((token) => !isCollectibleMarkerToken(token))
          .map((token) => createHistoryItemFromToken(token, `replayed-item-${itemSequence++}`, "restored"));

      const walk = (storyInstance: Story, baseHistory: HistoryElement[], depth: number): HistoryElement[] | null => {
        if (depth > maxChoiceDepth || visitedNodeCount > maxVisitedNodes) {
          return null;
        }

        const emittedLines: string[] = [];
        while (storyInstance.canContinue) {
          const line = storyInstance.Continue();
          if (line) {
            emittedLines.push(line.trim());
          }
        }

        const stateJson = storyInstance.state.ToJson();
        if (stateJson === targetStoryStateJson) {
          return baseHistory;
        }

        if (visitedStates.has(stateJson)) {
          return null;
        }

        visitedStates.add(stateJson);
        visitedNodeCount += 1;

        const choices = storyInstance.currentChoices.map((choice) => ({
          index: choice.index,
          text: choice.text,
        }));

        if (choices.length === 0) {
          return null;
        }

        const completedTurnHistory = [
          ...baseHistory,
          ...makeRestoredItems(resolveStoryLinesWithInlineImages(emittedLines, inlineImageAssets, inlineImageConfig)),
        ];

        for (const choice of choices) {
          const branchStory = new Story(storyJson);
          branchStory.state.LoadJson(stateJson);
          branchStory.ChooseChoiceIndex(choice.index);

          const replayedChoiceGroup: HistoryElement = {
            id: `replayed-choice-${itemSequence++}`,
            type: "choiceGroup",
            content: "",
            options: choices,
            selectedChoiceIndex: choice.index,
            displayedLength: 0,
            isTyping: false,
            isNew: false,
          };
          const result = walk(branchStory, [...completedTurnHistory, replayedChoiceGroup], depth + 1);
          if (result) {
            return result;
          }
        }

        return null;
      };

      try {
        return walk(new Story(storyJson), [], 0);
      } catch (error) {
        console.warn("Failed to replay reader history from Ink state:", error);
        return null;
      }
    },
    [createHistoryItemFromToken, inlineImageAssets, inlineImageConfig, storyJson],
  );

  useEffect(() => {
    if (!isNotebookSpread && defaultScrollRef.current) {
      defaultScrollRef.current.scrollTop = defaultScrollRef.current.scrollHeight;
    }
  }, [history, currentLinesToDisplay, isNotebookSpread]);

  useEffect(() => {
    if (lastInitializedTurnRef.current === turnCount) {
      return;
    }

    lastInitializedTurnRef.current = turnCount;
    setHasMeasuredNotebookPages(false);
    setMeasuredFlowSignature("");
    setCurrentLinesToDisplay(resolvedStoryLines);
    setLineIndex(0);
    setTypingItemId(null);
    setPendingRevealItemId(null);
    setHideActiveChoices(false);
    setChoicesRevealed(false);
  }, [resolvedStoryLines, turnCount]);

  useEffect(() => {
    if (!isNotebookSpread || !progressStorageKey) {
      readerProgressReadyRef.current = true;
      setTutorialEnabled(false);
      setTutorialStep(null);
      setTutorialAwaitingPrevPage(false);
      return;
    }

    if (turnCount <= 0) {
      return;
    }

    if (restoredProgressKeyRef.current === progressStorageKey) {
      readerProgressReadyRef.current = true;
      return;
    }

    restoredProgressKeyRef.current = progressStorageKey;

    const persistedRaw = storageGetItem(progressStorageKey);
    if (!persistedRaw) {
      let restoredFromStorySnapshot = false;

      if (storyStorageKey) {
        try {
          const storySnapshot = JSON.parse(storageGetItem(storyStorageKey) ?? "{}") as PersistedInkSnapshot;
          if (typeof storySnapshot.storyStateJson === "string") {
            const replayedHistory = replayHistoryToStoryState(storySnapshot.storyStateJson);
            if (replayedHistory?.length) {
              restoredFromStorySnapshot = true;
              setHasMeasuredNotebookPages(false);
              setMeasuredFlowSignature("");
              setNotebookPages(createEmptyNotebookPages());
              setHistory(dedupeAdjacentHistoryItems(replayedHistory));
              setCurrentLinesToDisplay(resolvedStoryLines);
              setLineIndex(0);
              setCurrentPageIndex(0);
              setUnlockedPageIndex(0);
            }
          }
        } catch (error) {
          console.warn("Failed to replay missing reader progress:", error);
        }
      }

      setTutorialEnabled(turnCount <= 1 && !restoredFromStorySnapshot);
      setTutorialSeen(createTutorialSeenState());
      setTutorialStep(null);
      setTutorialAwaitingPrevPage(false);
      readerProgressReadyRef.current = true;
      return;
    }

    try {
      const snapshot = JSON.parse(persistedRaw) as Partial<PersistedReaderSnapshot>;
      const rawHistory = Array.isArray(snapshot.history) ? snapshot.history : [];
      const snapshotLineIndex = typeof snapshot.lineIndex === "number" ? snapshot.lineIndex : 0;
      const snapshotCurrentPageIndex = typeof snapshot.currentPageIndex === "number" ? snapshot.currentPageIndex : 0;
      const snapshotUnlockedPageIndex = typeof snapshot.unlockedPageIndex === "number" ? snapshot.unlockedPageIndex : 0;
      const isFreshReaderSnapshot =
        rawHistory.length === 0 &&
        snapshotLineIndex <= 0 &&
        snapshotCurrentPageIndex <= 0 &&
        snapshotUnlockedPageIndex <= 0 &&
        typeof snapshot.typingItemId !== "string" &&
        typeof snapshot.selectedChoiceIndex !== "number" &&
        !snapshot.choicesRevealed;

      setTutorialEnabled(isFreshReaderSnapshot);
      setTutorialSeen(createTutorialSeenState());
      setTutorialStep(null);
      setTutorialAwaitingPrevPage(false);

      const restoredTypingItemId = typeof snapshot.typingItemId === "string" ? snapshot.typingItemId : null;
      const normalizedHistory = rawHistory.map((item) => {
        if (item.type === "image") {
          const normalizedImageId = item.imageId?.toUpperCase() ?? resolveInlineImageId(item.content ?? "", inlineImageAssets);

          if (!normalizedImageId) {
            return item;
          }

          return {
            ...item,
            imageId: normalizedImageId,
            imageSrc: inlineImageAssets[normalizedImageId]?.src ?? item.imageSrc,
            imageLayout: inlineImageAssets[normalizedImageId]?.layout ?? item.imageLayout ?? "column",
            content: buildImageMarkerToken(normalizedImageId),
          };
        }

        if (item.type !== "text" || !item.content) {
          return item;
        }

        if (item.isTyping || item.displayedLength === 0 || item.id === restoredTypingItemId) {
          return {
            ...item,
            displayedLength: item.content.length,
            isTyping: false,
          };
        }

        return item;
      });
      let baseHistory = normalizedHistory;
      let shouldRestoreLatestPageAfterMeasure = false;

      if (storyStorageKey) {
        try {
          const storySnapshot = JSON.parse(storageGetItem(storyStorageKey) ?? "{}") as PersistedInkSnapshot;
          if (typeof storySnapshot.storyStateJson === "string") {
            const replayedHistory = replayHistoryToStoryState(storySnapshot.storyStateJson);
            if (replayedHistory) {
              const normalizedTokens = normalizedHistory
                .map((item) => getHistoryToken(item))
                .filter((token): token is string => Boolean(token));
              const replayedTokens = replayedHistory
                .map((item) => getHistoryToken(item))
                .filter((token): token is string => Boolean(token));
              const normalizedLooksLikeFullPrefix =
                replayedTokens.length === 0 ||
                replayedTokens.every((token, index) => normalizedTokens[index] === token);

              shouldRestoreLatestPageAfterMeasure = !normalizedLooksLikeFullPrefix;
              baseHistory = replayedHistory;
            }
          }
        } catch (error) {
          console.warn("Failed to replay reader history from stored story state:", error);
        }
      }

      const snapshotTurnCount = typeof snapshot.turnCount === "number" ? snapshot.turnCount : turnCount;
      const restoredLineIndex = snapshotLineIndex;
      const restoredLines = Array.isArray(snapshot.currentLinesToDisplay) ? snapshot.currentLinesToDisplay : resolvedStoryLines;
      const introducedLines = restoredLines.slice(0, Math.max(restoredLineIndex, 0));
      const introducedHistoryLines = introducedLines.filter((token) => !isCollectibleMarkerToken(token));
      const normalizedHistoryTokens = baseHistory
        .map((item) => getHistoryToken(item))
        .filter((token): token is string => Boolean(token));

      let suffixMatchCount = 0;
      for (let candidate = Math.min(introducedHistoryLines.length, normalizedHistoryTokens.length); candidate >= 0; candidate -= 1) {
        const historySuffix = normalizedHistoryTokens.slice(-candidate);
        const introducedPrefix = introducedHistoryLines.slice(0, candidate);
        if (
          historySuffix.length === introducedPrefix.length &&
          historySuffix.every((content, index) => content === introducedPrefix[index])
        ) {
          suffixMatchCount = candidate;
          break;
        }
      }

      const missingIntroducedLines = introducedHistoryLines.slice(suffixMatchCount);
      const restoredHistory = missingIntroducedLines.length
        ? [
            ...baseHistory,
            ...missingIntroducedLines.map((token, index) =>
              createHistoryItemFromToken(token, `restored-item-${snapshotTurnCount}-${suffixMatchCount + index}`, "restored"),
            ),
          ]
        : baseHistory;

      setHasMeasuredNotebookPages(false);
      setMeasuredFlowSignature("");
      setNotebookPages(createEmptyNotebookPages());
      setHistory(dedupeAdjacentHistoryItems(restoredHistory));
      setCurrentLinesToDisplay(restoredLines);
      setLineIndex(restoredLineIndex);
      restorePageTargetRef.current = shouldRestoreLatestPageAfterMeasure ? "latest" : "snapshot";
      setCurrentPageIndex(typeof snapshot.currentPageIndex === "number" ? snapshot.currentPageIndex : 0);
      setUnlockedPageIndex(
        typeof snapshot.unlockedPageIndex === "number"
          ? Math.max(snapshot.unlockedPageIndex, typeof snapshot.currentPageIndex === "number" ? snapshot.currentPageIndex : 0)
          : typeof snapshot.currentPageIndex === "number"
            ? snapshot.currentPageIndex
            : 0,
      );
      setTypingItemId(null);
      setPendingRevealItemId(null);
      setSelectedChoiceIndex(typeof snapshot.selectedChoiceIndex === "number" ? snapshot.selectedChoiceIndex : null);
      setChoicesRevealed(Boolean(snapshot.choicesRevealed));
    } catch (error) {
      console.warn("Failed to restore reader progress:", error);
      storageRemoveItem(progressStorageKey);
    }

    readerProgressReadyRef.current = true;
  }, [
    createHistoryItemFromToken,
    getHistoryToken,
    inlineImageAssets,
    isNotebookSpread,
    progressStorageKey,
    replayHistoryToStoryState,
    resolvedStoryLines,
    storyStorageKey,
    turnCount,
  ]);

  useEffect(() => {
    return () => {
      if (choiceCommitTimeoutRef.current !== null) {
        window.clearTimeout(choiceCommitTimeoutRef.current);
      }
      if (chapterExitTimeoutRef.current !== null) {
        window.clearTimeout(chapterExitTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCompletingChapterExit) {
      return;
    }

    chapterExitTimeoutRef.current = window.setTimeout(() => {
      chapterExitTimeoutRef.current = null;
      onReadComplete?.();
    }, CHAPTER_EXIT_FADE_MS);

    return () => {
      if (chapterExitTimeoutRef.current !== null) {
        window.clearTimeout(chapterExitTimeoutRef.current);
        chapterExitTimeoutRef.current = null;
      }
    };
  }, [isCompletingChapterExit, onReadComplete]);

  useEffect(() => {
    if (!typingItemId) {
      return undefined;
    }
    if (!isActive || isPaused) {
      return undefined;
    }

    const typingItem = history.find((item) => item.id === typingItemId);
    if (!typingItem || typingItem.type !== "text") {
      setTypingItemId(null);
      return undefined;
    }

    const currentLength = typingItem.displayedLength ?? 0;
    if (currentLength >= typingItem.content.length) {
      setHistory((prev) =>
        prev.map((item) =>
          item.id === typingItemId
            ? {
                ...item,
                displayedLength: item.content.length,
                isTyping: false,
              }
            : item,
        ),
      );
      setTypingItemId(null);
      maybeTriggerCollectible(typingItem);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setHistory((prev) =>
        prev.map((item) =>
          item.id === typingItemId && item.type === "text"
            ? {
                ...item,
                displayedLength: Math.min(item.content.length, (item.displayedLength ?? 0) + 1),
              }
            : item,
        ),
      );
    }, typewriterStepMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [history, isActive, isPaused, maybeTriggerCollectible, typewriterStepMs, typingItemId]);

  const revealTypingParagraph = () => {
    if (!typingItemId) return;

    const typingItem = history.find((item) => item.id === typingItemId);

    setHistory((prev) =>
      prev.map((item) =>
        item.id === typingItemId && item.type === "text"
          ? {
              ...item,
              displayedLength: item.content.length,
              isTyping: false,
            }
          : item,
      ),
    );
    setTypingItemId(null);
    maybeTriggerCollectible(typingItem);
  };

  const handleAdvance = () => {
    if (isPaused || pendingRevealItemId || isPageTransitioning) {
      if (isPaused) {
        onPausedAdvanceAttempt?.();
      }
      return;
    }

    if (typingItemId) {
      revealTypingParagraph();
      return;
    }

    if (lineIndex >= currentLinesToDisplay.length) return;

    const nextToken = currentLinesToDisplay[lineIndex];
    const collectibleMarkerId = resolveCollectibleMarkerId(nextToken);

    if (collectibleMarkerId) {
      const collectedIds = new Set(collectedCollectibleIds.map((id) => id.toUpperCase()));

      if (!collectedIds.has(collectibleMarkerId) && !triggeredCollectibleIdsRef.current.has(collectibleMarkerId)) {
        triggeredCollectibleIdsRef.current.add(collectibleMarkerId);
        onCollectibleTrigger?.(collectibleMarkerId);
      }

      setLineIndex((prev) => prev + 1);
      return;
    }

    const isImageItem = Boolean(resolveInlineImageId(nextToken, inlineImageAssets));
    const itemId = `${isImageItem ? "image" : "text"}-${Date.now()}-${lineIndex}`;

    setHistory((prev) => [...prev, createHistoryItemFromToken(nextToken, itemId, "interactive")]);

    if (isNotebookSpread) {
      setPendingRevealItemId(itemId);
    }

    setLineIndex((prev) => prev + 1);
  };

  const completeTutorialStep = useCallback((step: TutorialStepId) => {
    setTutorialSeen((prev) => (prev[step] ? prev : { ...prev, [step]: true }));
    setTutorialStep((prev) => (prev === step ? null : prev));
  }, []);

  useEffect(() => {
    if (
      !isNotebookSpread ||
      !isActive ||
      isPaused ||
      isPageTransitioning ||
      isCompletingChapterExit ||
      !readerProgressReadyRef.current ||
      history.length > 0 ||
      lineIndex !== 0 ||
      currentLinesToDisplay.length === 0 ||
      typingItemId ||
      pendingRevealItemId
    ) {
      return;
    }

    handleAdvance();
  }, [
    currentLinesToDisplay.length,
    history.length,
    isActive,
    isCompletingChapterExit,
    isNotebookSpread,
    isPageTransitioning,
    isPaused,
    lineIndex,
    pendingRevealItemId,
    typingItemId,
  ]);

  const handleChoice = (index: number, text: string) => {
    if (isNotebookSpread) {
      setHideActiveChoices(true);
      setHistory((prev) => [
        ...prev,
        {
          id: `choice-group-${Date.now()}`,
          type: "choiceGroup",
          content: "",
          options: currentChoices.map((choice) => ({ index: choice.index, text: choice.text })),
          selectedChoiceIndex: index,
          displayedLength: 0,
          isTyping: false,
          isNew: false,
        },
      ]);
    } else {
      setHistory((prev) => [
        ...prev,
        {
          id: `choice-res-${Date.now()}`,
          type: "choice",
          content: text,
          displayedLength: text.length,
          isTyping: false,
        },
      ]);
    }

    setCurrentLinesToDisplay([]);
    setTypingItemId(null);
    setChoicesRevealed(false);
    selectChoice(index);
  };

  const beginChoiceSelection = (index: number, text: string) => {
    if (selectedChoiceIndex !== null) {
      return;
    }

    setSelectedChoiceIndex(index);
    choiceCommitTimeoutRef.current = window.setTimeout(() => {
      choiceCommitTimeoutRef.current = null;
      handleChoice(index, text);
    }, CHOICE_RESOLVE_DELAY_MS);
  };

  const canAdvance = lineIndex < currentLinesToDisplay.length;
  const hasOnlyChapterBoundaryChoices =
    currentChoices.length > 0 && currentChoices.every((choice) => isChapterBoundaryChoiceText(choice.text));
  const canRevealChoices =
    !hasOnlyChapterBoundaryChoices &&
    !canAdvance &&
    currentChoices.length > 0 &&
    !hideActiveChoices &&
    !typingItemId &&
    !pendingRevealItemId;
  const showChoices = canRevealChoices && choicesRevealed;
  const flowItems: JournalFlowItem[] = useMemo(
    () => [
      ...history.map((item) => ({
        id: item.id,
        kind: "history" as const,
        item,
      })),
      ...(showChoices ? [{ id: "choices", kind: "choices" as const }] : []),
      ...(!isNotebookSpread && canAdvance ? [{ id: "hint", kind: "hint" as const }] : []),
      ...(!isNotebookSpread && isEnded && !canAdvance && currentChoices.length === 0
        ? [{ id: "end", kind: "end" as const }]
        : []),
    ],
    [canAdvance, choiceSignature, history, isEnded, isNotebookSpread, showChoices],
  );
  const flowSignature = useMemo(() => flowItems.map((flowItem) => flowItem.id).join("|"), [flowItems]);
  const notebookPagesReady = !isNotebookSpread || (hasMeasuredNotebookPages && measuredFlowSignature === flowSignature);

  useEffect(() => {
    if (
      !isActive ||
      isPaused ||
      !isNotebookSpread ||
      !notebookPagesReady ||
      !pendingRevealItemId ||
      typingItemId ||
      isPageTransitioning
    ) {
      return;
    }

    const pendingItem = history.find((item) => item.id === pendingRevealItemId);

    if (!pendingItem) {
      setPendingRevealItemId(null);
      return;
    }

    const pendingPageIndex = notebookPages.findIndex(
      (page) =>
        page.rows.some((row) =>
          row.kind === "spread"
            ? row.item.id === pendingRevealItemId
            : row.left.some((flowItem) => flowItem.id === pendingRevealItemId) ||
              row.right.some((flowItem) => flowItem.id === pendingRevealItemId),
        ),
    );

    if (pendingPageIndex === -1) {
      return;
    }

    const shouldWaitForTutorialPageTurn =
      tutorialEnabled && !tutorialSeen.nextPage && pendingItem.type !== "image" && pendingPageIndex > currentPageIndex;

    if (pendingPageIndex !== currentPageIndex && !shouldWaitForTutorialPageTurn) {
      setIsPageTransitioning(true);
      setCurrentPageIndex(pendingPageIndex);
      return;
    }

    if (pendingItem.type === "image") {
      setPendingRevealItemId(null);
      return;
    }

    setHistory((prev) =>
      prev.map((item) =>
        item.id === pendingRevealItemId && item.type === "text"
          ? {
              ...item,
              isTyping: true,
            }
          : item,
      ),
    );
    setTypingItemId(pendingRevealItemId);
    setPendingRevealItemId(null);
  }, [
    currentPageIndex,
    history,
    isActive,
    isPaused,
    isNotebookSpread,
    isPageTransitioning,
    notebookPages,
    notebookPagesReady,
    pendingRevealItemId,
    tutorialEnabled,
    tutorialSeen.nextPage,
    typingItemId,
  ]);

  useEffect(() => {
    if (!showChoices) {
      setSelectedChoiceIndex(null);
      setHoveredChoiceIndex(null);
    }
  }, [showChoices]);

  const isReadComplete =
    isNotebookSpread &&
    notebookPagesReady &&
    (isEnded || hasOnlyChapterBoundaryChoices) &&
    !showChoices &&
    !typingItemId &&
    !pendingRevealItemId &&
    lineIndex >= currentLinesToDisplay.length &&
    currentPageIndex >= Math.max(notebookPages.length - 1, 0);

  useEffect(() => {
    if (
      !autoPlayEnabled ||
      !isActive ||
      isPaused ||
      !isNotebookSpread ||
      !readerProgressReadyRef.current ||
      !notebookPagesReady ||
      isPageTransitioning ||
      isCompletingChapterExit ||
      tutorialStep ||
      typingItemId ||
      pendingRevealItemId ||
      showChoices ||
      !canAdvance
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      handleAdvance();
    }, AUTO_PLAY_PARAGRAPH_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    autoPlayEnabled,
    canAdvance,
    handleAdvance,
    isActive,
    isCompletingChapterExit,
    isNotebookSpread,
    isPageTransitioning,
    isPaused,
    notebookPagesReady,
    pendingRevealItemId,
    showChoices,
    tutorialStep,
    typingItemId,
  ]);

  const renderChoiceText = (text: string, settled: boolean) => (
    <span aria-hidden="true">
      {Array.from(text).map((char, charIndex) => (
        <span
          key={`${text}-${charIndex}`}
          className={settled ? "afterland-choice-glyph afterland-choice-glyph--still" : "afterland-choice-glyph"}
          style={{ animationDelay: `${charIndex * 34}ms` }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </span>
  );

  const renderResolvedChoiceGroup = (
    options: ChoiceOption[],
    selectedIndex: number,
    measurement = false,
  ) => {
    const containerClass = isNotebookSpread ? "flex flex-col gap-[10pt] pt-[4pt]" : "space-y-3 pt-4";

    return (
      <div key={`choice-group-${selectedIndex}`} className={containerClass}>
        {options.map((choice) => {
          const isSelected = choice.index === selectedIndex;
          const sharedClassName = isNotebookSpread
            ? "afterland-copy afterland-story-copy flex w-full items-start gap-[10pt] pr-1 text-left font-chinese"
            : "afterland-copy afterland-body flex w-full items-start gap-3 pr-3 text-left font-chinese";
          const diamondClassName = isNotebookSpread
            ? "mt-[0.42em] h-[0.38rem] w-[0.38rem] shrink-0 rotate-45 border border-current"
            : "mt-[0.48em] h-[0.38rem] w-[0.38rem] shrink-0 rotate-45 border border-current";
          const style = isNotebookSpread ? defaultBodyTextStyle : undefined;
          const settledColor = isNotebookSpread ? "#6C3B0C" : "var(--afterland-accent)";
          const resolvedStyle = {
            ...style,
            color: settledColor,
            opacity: isSelected ? 1 : 0.15,
          } as React.CSSProperties;

          return (
            <div key={choice.index} className={sharedClassName} style={resolvedStyle}>
              <span className={diamondClassName} />
              <span>{measurement ? choice.text : renderChoiceText(choice.text, isSelected)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const latestHistoryItemId = history.length > 0 ? history[history.length - 1]?.id ?? null : null;

  useLayoutEffect(() => {
    if (!isNotebookSpread) return undefined;

    const body = notebookBodyRef.current;
    if (!body) return undefined;

    const updateBodySize = () => {
      const nextWidth = body.clientWidth;
      const nextHeight = body.clientHeight;

      setBodySize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }

        return { width: nextWidth, height: nextHeight };
      });
    };

    updateBodySize();

    const observer = new ResizeObserver(() => {
      updateBodySize();
    });

    observer.observe(body);

    return () => {
      observer.disconnect();
    };
  }, [isNotebookSpread]);

  const measurementColumnWidth =
    bodySize.width > NOTEBOOK_COLUMN_GAP_PX ? (bodySize.width - NOTEBOOK_COLUMN_GAP_PX) / 2 : 0;
  const measurementSpreadWidth = bodySize.width;
  const handleMeasurementImageSettled = useCallback((imageId?: string) => {
    if (!imageId) {
      return;
    }

    const normalizedImageId = imageId.toUpperCase();
    if (measuredImageIdsRef.current.has(normalizedImageId)) {
      return;
    }

    measuredImageIdsRef.current.add(normalizedImageId);
    setMeasurementImageVersion((version) => version + 1);
  }, []);

  useLayoutEffect(() => {
    if (!isNotebookSpread) return;

    const measureRoot = notebookMeasureRef.current;
    if (!measureRoot || measurementColumnWidth <= 0 || measurementSpreadWidth <= 0 || bodySize.height <= 0) return;

    const measureItems = Array.from(measureRoot.children) as HTMLElement[];
    if (measureItems.length !== flowItems.length) return;

    const hasUnreadyImage = measureItems.some((item) => {
      const image = item.querySelector("img");
      return Boolean(image && (!image.complete || image.naturalWidth === 0 || image.offsetHeight <= 0));
    });

    if (hasUnreadyImage) {
      setHasMeasuredNotebookPages(false);
      return;
    }

    const itemHeights = measureItems.map((item) => Math.ceil(item.offsetHeight));
    const nextPages = buildNotebookPages(flowItems, itemHeights, bodySize.height, notebookParagraphGapPx);
    setNotebookPages(nextPages);
    setMeasuredFlowSignature(flowSignature);
    setHasMeasuredNotebookPages(true);
  }, [
    bodySize.height,
    bodyTextSizePt,
    flowItems,
    flowSignature,
    isNotebookSpread,
    measurementColumnWidth,
    measurementImageVersion,
    measurementSpreadWidth,
    notebookParagraphGapPx,
  ]);

  const latestReadablePageIndex = useMemo(() => {
    if (!notebookPagesReady) {
      return currentPageIndex;
    }

    const pendingIndex = findPageIndexByFlowItemId(notebookPages, pendingRevealItemId);
    if (pendingIndex >= 0) {
      return pendingIndex;
    }

    const choicesIndex = showChoices ? findPageIndexByFlowItemId(notebookPages, "choices") : -1;
    if (choicesIndex >= 0) {
      return choicesIndex;
    }

    const historyIndex = findPageIndexByFlowItemId(notebookPages, latestHistoryItemId);
    if (historyIndex >= 0) {
      return historyIndex;
    }

    return 0;
  }, [currentPageIndex, latestHistoryItemId, notebookPages, notebookPagesReady, pendingRevealItemId, showChoices]);

  useEffect(() => {
    if (!isNotebookSpread) return;

    const pageCount = Math.max(notebookPages.length, 1);

    if (!notebookPagesReady) {
      return;
    }

    const clampedMaxIndex = Math.max(0, Math.min(pageCount - 1, latestReadablePageIndex));

    setUnlockedPageIndex((prev) => Math.max(0, Math.min(pageCount - 1, Math.max(prev, latestReadablePageIndex))));

    if (currentPageIndex > clampedMaxIndex) {
      setCurrentPageIndex(clampedMaxIndex);
    }
  }, [currentPageIndex, isNotebookSpread, latestReadablePageIndex, notebookPages.length, notebookPagesReady]);

  useEffect(() => {
    if (!isNotebookSpread || !notebookPagesReady || restorePageTargetRef.current !== "latest") {
      return;
    }

    restorePageTargetRef.current = "snapshot";
    setCurrentPageIndex(latestReadablePageIndex);
    setUnlockedPageIndex((prev) => Math.max(prev, latestReadablePageIndex));
  }, [isNotebookSpread, latestReadablePageIndex, notebookPagesReady]);

  useEffect(() => {
    if (!isNotebookSpread || !progressStorageKey) {
      return;
    }

    if (!readerProgressReadyRef.current) {
      return;
    }

    if (!notebookPagesReady) {
      return;
    }

    const snapshot: PersistedReaderSnapshot = {
      history,
      currentLinesToDisplay,
      lineIndex,
      currentPageIndex,
      unlockedPageIndex,
      typingItemId,
      selectedChoiceIndex,
      choicesRevealed,
      turnCount,
    };

    storageSetItem(progressStorageKey, JSON.stringify(snapshot));
  }, [
    currentLinesToDisplay,
    currentPageIndex,
    choicesRevealed,
    history,
    isNotebookSpread,
    lineIndex,
    notebookPagesReady,
    progressStorageKey,
    selectedChoiceIndex,
    turnCount,
    typingItemId,
    unlockedPageIndex,
  ]);

  const renderHistoryItem = (item: HistoryElement, measurement = false) => {
    if (item.type === "choiceGroup") {
      return renderResolvedChoiceGroup(item.options ?? [], item.selectedChoiceIndex ?? -1, measurement);
    }

    if (item.type === "image") {
      const imageSrc = item.imageSrc ?? (item.imageId ? inlineImageAssets[item.imageId]?.src : undefined);

      if (!imageSrc) {
        return null;
      }

      const isNotebookInlineSketch = isNotebookSpread && item.imageLayout !== "spread";
      const inlineSketchWrapperClass = isNotebookInlineSketch
        ? `relative left-1/2 w-[${NOTEBOOK_INLINE_SKETCH_WIDTH_PERCENT}%] max-w-none -translate-x-1/2`
        : "w-full";

      const imageNode = (
        <img
          src={imageSrc}
          alt=""
          className="pointer-events-none block h-auto w-full select-none object-contain"
          draggable={false}
          onLoad={measurement ? () => handleMeasurementImageSettled(item.imageId) : undefined}
        />
      );

      if (measurement) {
        return <div className={inlineSketchWrapperClass}>{imageNode}</div>;
      }

      return (
        <motion.div
          key={item.id}
          initial={item.isNew ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`${inlineSketchWrapperClass} ${item.imageLayout === "spread" ? "overflow-hidden rounded-[0.35rem]" : ""}`}
        >
          {imageNode}
        </motion.div>
      );
    }

    const notebookClassName =
      item.type === "choice"
        ? "afterland-copy afterland-story-copy font-chinese whitespace-pre-line border-y border-[#6C3B0C]/14 py-[9pt] italic tracking-[0.01em] text-[#6C3B0C]"
        : "afterland-copy afterland-story-copy font-chinese whitespace-pre-line tracking-[0.01em] text-[#6C3B0C]";
    const defaultClassName =
      item.type === "choice"
        ? "afterland-copy afterland-body border-y border-[var(--afterland-accent)]/10 py-2 font-medium text-[var(--afterland-accent)] italic opacity-100"
        : "afterland-copy afterland-body text-[var(--afterland-ink)]/80 text-indent-2em";
    const className = isNotebookSpread ? notebookClassName : defaultClassName;
    const style = isNotebookSpread ? notebookBodyTextStyle : defaultBodyTextStyle;

    const content = (
      <>
        {item.type === "choice" && <span className="afterland-meta mr-2 opacity-40">{ui.choicePrefix}</span>}
        {measurement
          ? item.content
          : item.type === "text"
            ? item.content.slice(0, item.displayedLength ?? item.content.length)
            : item.content}
      </>
    );

    if (measurement) {
      return (
        <p className={className} style={style}>
          {content}
        </p>
      );
    }

    if (isNotebookSpread) {
      return (
        <p key={item.id} className={className} style={style}>
          {content}
        </p>
      );
    }

    return (
      <motion.p
        key={item.id}
        initial={item.isNew ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className={className}
        style={style}
      >
        {content}
      </motion.p>
    );
  };

  const renderChoices = (measurement = false) => {
    const notebookContainerClass = "flex flex-col gap-[10pt] pt-[4pt]";
    const defaultContainerClass = "space-y-3 pt-4";

    const choiceButtons = currentChoices.map((choice) => {
      const isResolving = selectedChoiceIndex !== null;
      const isSelected = selectedChoiceIndex === choice.index;
      const isFadingOut = isResolving && !isSelected;
      const isHovered = hoveredChoiceIndex === choice.index && !isResolving && !isSelected;
      const sharedClassName = isNotebookSpread
        ? "afterland-copy afterland-story-copy flex w-full items-start gap-[10pt] pr-1 text-left font-chinese transition-[opacity,color,filter] duration-[420ms] ease-out"
        : "afterland-copy afterland-body flex w-full items-start gap-3 pr-3 text-left font-chinese transition-[opacity,color,filter] duration-[420ms] ease-out";
      const diamondClassName = isNotebookSpread
        ? "mt-[0.42em] h-[0.38rem] w-[0.38rem] shrink-0 rotate-45 border border-current"
        : "mt-[0.48em] h-[0.38rem] w-[0.38rem] shrink-0 rotate-45 border border-current";
      const style = isNotebookSpread ? defaultBodyTextStyle : undefined;
      const settledColor = isNotebookSpread ? "#6C3B0C" : "var(--afterland-accent)";
      const animatedStyle = {
        ...style,
        color: settledColor,
      } as React.CSSProperties;

      if (measurement) {
        return (
          <button key={choice.index} type="button" disabled className={sharedClassName} style={animatedStyle}>
            <span className={diamondClassName} />
            <span>{choice.text}</span>
          </button>
        );
      }

      return (
        <motion.button
          key={choice.index}
          initial={{ opacity: 0 }}
          animate={
            isFadingOut
              ? { opacity: 0.15, filter: "blur(0.6px)" }
              : { opacity: isSelected ? 1 : isHovered ? 0.9 : 0.7, filter: "blur(0px)" }
          }
          transition={{ duration: isFadingOut ? 0.4 : 0.26, ease: "easeOut" }}
          type="button"
          aria-label={choice.text}
          disabled={isResolving}
          onHoverStart={() => {
            if (!isResolving) {
              setHoveredChoiceIndex(choice.index);
            }
          }}
          onHoverEnd={() => {
            setHoveredChoiceIndex((prev) => (prev === choice.index ? null : prev));
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (tutorialStep === "choice") {
              completeTutorialStep("choice");
            }
            beginChoiceSelection(choice.index, choice.text);
          }}
          className={sharedClassName}
          style={animatedStyle}
        >
          <span className={diamondClassName} />
          <span>{renderChoiceText(choice.text, isSelected)}</span>
        </motion.button>
      );
    });

    return (
      <div
        key="choices"
        ref={!measurement && isNotebookSpread ? choicesContainerRef : undefined}
        className={isNotebookSpread ? notebookContainerClass : defaultContainerClass}
      >
        {choiceButtons}
      </div>
    );
  };

  const renderHint = () => (
    <motion.div
      key="hint"
      animate={{ opacity: [0.2, 0.5, 0.2] }}
      transition={{ repeat: Infinity, duration: 2 }}
      className="afterland-meta flex items-center gap-2 pt-4 uppercase text-[var(--afterland-accent)]/40"
    >
      [ {ui.continueHint} ]
    </motion.div>
  );

  const renderEndNote = () => (
    <motion.div
      key="end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.4 }}
      className="flex items-center gap-4 border-t border-[var(--afterland-ink)]/10 pt-12"
    >
      <Sparkles className="h-4 w-4 text-[var(--afterland-accent)]" />
      <span className="afterland-meta uppercase font-display">{ui.narrativeEnded}</span>
    </motion.div>
  );

  const renderFlowItem = (flowItem: JournalFlowItem, measurement = false) => {
    switch (flowItem.kind) {
      case "history":
        return renderHistoryItem(flowItem.item, measurement);
      case "choices":
        return renderChoices(measurement);
      case "hint":
        return renderHint();
      case "end":
        return renderEndNote();
      default:
        return null;
    }
  };

  const readCharacterCount = useMemo(() => {
    const historyCount = history.reduce((sum, item) => {
      if (item.type === "text") {
        return sum + Math.min(item.displayedLength ?? item.content.length, item.content.length);
      }

      if (item.type === "choice") {
        return sum + item.content.length;
      }

      if (item.type === "choiceGroup") {
        return sum + (item.options ?? []).reduce((optionSum, option) => optionSum + option.text.length, 0);
      }

      return sum;
    }, 0);

    const activeChoiceCount = showChoices
      ? currentChoices.reduce((sum, choice) => sum + choice.text.length, 0)
      : 0;

    return historyCount + activeChoiceCount;
  }, [currentChoices, history, showChoices]);

  const partiallyDisplayedCharacterCount = useMemo(
    () =>
      history.reduce((sum, item) => {
        if (item.type !== "text") {
          return sum;
        }

        const displayedLength = Math.min(item.displayedLength ?? item.content.length, item.content.length);
        return sum + (item.content.length - displayedLength);
      }, 0),
    [history],
  );

  const queuedCharacterCount = useMemo(
    () => currentLinesToDisplay.slice(lineIndex).reduce((sum, token) => sum + countTokenCharacters(token, inlineImageAssets), 0),
    [currentLinesToDisplay, inlineImageAssets, lineIndex],
  );

  const futureCharacterCount = useMemo(() => {
    if (!storyJson || !story?.state) {
      return 0;
    }

    try {
      return countRemainingCharactersFromStoryState(storyJson, story.state.ToJson());
    } catch (error) {
      console.warn("Failed to simulate remaining story characters for progress:", error);
      return 0;
    }
  }, [story, storyJson]);

  const resolvedTotalCharacterCount = useMemo(() => {
    const dynamicTotal =
      readCharacterCount + partiallyDisplayedCharacterCount + queuedCharacterCount + futureCharacterCount;

    if (storyJson && story?.state) {
      return Math.max(dynamicTotal, 1);
    }

    return Math.max(totalCharacterCount, 1);
  }, [
    futureCharacterCount,
    partiallyDisplayedCharacterCount,
    queuedCharacterCount,
    readCharacterCount,
    story,
    storyJson,
    totalCharacterCount,
  ]);

  const progressRatio = Math.max(0, Math.min(1, readCharacterCount / resolvedTotalCharacterCount));
  const reachablePageIndex = Math.max(
    0,
    Math.min(notebookPages.length - 1, Math.max(unlockedPageIndex, latestReadablePageIndex)),
  );
  const canGoPrevPage = isNotebookSpread && notebookPagesReady && !isPageTransitioning && currentPageIndex > 0;
  const canGoForwardPage =
    isNotebookSpread && notebookPagesReady && !isPageTransitioning && currentPageIndex < reachablePageIndex;

  useEffect(() => {
    if (tutorialEnabled && isNotebookSpread && isActive && !isCompletingChapterExit) {
      return;
    }

    setTutorialStep(null);
    setTutorialAwaitingPrevPage(false);
  }, [isActive, isCompletingChapterExit, isNotebookSpread, tutorialEnabled]);

  useEffect(() => {
    if (
      !tutorialEnabled ||
      !isActive ||
      !isNotebookSpread ||
      isPaused ||
      isPageTransitioning ||
      isCompletingChapterExit ||
      tutorialStep ||
      tutorialSeen.advance ||
      typingItemId ||
      pendingRevealItemId ||
      !notebookPagesReady
    ) {
      return;
    }

    const hasCompletedParagraph = history.some(
      (item) => item.type === "text" && (item.displayedLength ?? item.content.length) >= item.content.length,
    );

    if (hasCompletedParagraph && (canAdvance || canRevealChoices || currentChoices.length > 0 || isReadComplete)) {
      setTutorialStep("advance");
    }
  }, [
    canAdvance,
    canRevealChoices,
    currentChoices.length,
    history,
    isActive,
    isCompletingChapterExit,
    isNotebookSpread,
    isPageTransitioning,
    isPaused,
    isReadComplete,
    notebookPagesReady,
    pendingRevealItemId,
    tutorialEnabled,
    tutorialSeen.advance,
    tutorialStep,
    typingItemId,
  ]);

  useEffect(() => {
    if (
      !tutorialEnabled ||
      !isActive ||
      !isNotebookSpread ||
      isPaused ||
      isPageTransitioning ||
      isCompletingChapterExit ||
      tutorialStep ||
      !tutorialSeen.advance ||
      tutorialSeen.choice ||
      selectedChoiceIndex !== null ||
      !showChoices
    ) {
      return;
    }

    setTutorialStep("choice");
  }, [
    isActive,
    isCompletingChapterExit,
    isNotebookSpread,
    isPageTransitioning,
    isPaused,
    selectedChoiceIndex,
    showChoices,
    tutorialEnabled,
    tutorialSeen.advance,
    tutorialSeen.choice,
    tutorialStep,
  ]);

  useEffect(() => {
    if (
      !tutorialEnabled ||
      !isActive ||
      !isNotebookSpread ||
      isPaused ||
      isPageTransitioning ||
      isCompletingChapterExit ||
      tutorialStep ||
      !tutorialSeen.advance ||
      tutorialSeen.nextPage ||
      typingItemId ||
      !canGoForwardPage
    ) {
      return;
    }

    setTutorialStep("nextPage");
  }, [
    canGoForwardPage,
    isActive,
    isCompletingChapterExit,
    isNotebookSpread,
    isPageTransitioning,
    isPaused,
    tutorialEnabled,
    tutorialSeen.advance,
    tutorialSeen.nextPage,
    tutorialStep,
    typingItemId,
  ]);

  useEffect(() => {
    if (
      !tutorialEnabled ||
      !isActive ||
      !isNotebookSpread ||
      isPaused ||
      isPageTransitioning ||
      isCompletingChapterExit ||
      tutorialStep ||
      !tutorialSeen.nextPage ||
      tutorialSeen.prevPage ||
      !tutorialAwaitingPrevPage ||
      !canGoPrevPage
    ) {
      return;
    }

    setTutorialStep("prevPage");
  }, [
    canGoPrevPage,
    isActive,
    isCompletingChapterExit,
    isNotebookSpread,
    isPageTransitioning,
    isPaused,
    tutorialAwaitingPrevPage,
    tutorialEnabled,
    tutorialSeen.nextPage,
    tutorialSeen.prevPage,
    tutorialStep,
  ]);

  useLayoutEffect(() => {
    if (tutorialStep !== "choice") {
      setTutorialChoiceTargetRect(null);
      return undefined;
    }

    const root = notebookRootRef.current;
    const choices = choicesContainerRef.current;

    if (!root || !choices) {
      setTutorialChoiceTargetRect(null);
      return undefined;
    }

    let frameId = 0;
    const updateChoiceTarget = () => {
      const rootRect = root.getBoundingClientRect();
      const choiceRect = choices.getBoundingClientRect();
      const paddingX = 30;
      const paddingY = 24;
      const nextRect = {
        left: Math.round(choiceRect.left - rootRect.left - paddingX),
        top: Math.round(choiceRect.top - rootRect.top - paddingY),
        width: Math.round(choiceRect.width + paddingX * 2),
        height: Math.round(choiceRect.height + paddingY * 2),
      };

      setTutorialChoiceTargetRect((prev) => {
        if (
          prev &&
          prev.left === nextRect.left &&
          prev.top === nextRect.top &&
          prev.width === nextRect.width &&
          prev.height === nextRect.height
        ) {
          return prev;
        }

        return nextRect;
      });
    };

    updateChoiceTarget();
    frameId = window.requestAnimationFrame(updateChoiceTarget);
    const observer = new ResizeObserver(updateChoiceTarget);
    observer.observe(root);
    observer.observe(choices);
    window.addEventListener("resize", updateChoiceTarget);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", updateChoiceTarget);
    };
  }, [
    bodySize.height,
    bodySize.width,
    currentPageIndex,
    flowSignature,
    notebookPagesReady,
    showChoices,
    tutorialStep,
  ]);

  if (isNotebookSpread && notebookSpreadControls) {
    const currentPage =
      notebookPages[currentPageIndex] ??
      notebookPages[0] ?? {
        id: "page-0-empty",
        rows: [{ id: "row-empty-fallback", kind: "columns" as const, left: [], right: [] }],
      };
    const shouldHoldPendingImage = (flowItem: JournalFlowItem) =>
      flowItem.id === pendingRevealItemId &&
      flowItem.kind === "history" &&
      flowItem.item.type === "image";

    const advanceNotebookBody = () => {
      if (!notebookPagesReady || isPageTransitioning || isCompletingChapterExit) {
        return;
      }

      if (isPaused) {
        onPausedAdvanceAttempt?.();
        return;
      }

      if (currentPageIndex < latestReadablePageIndex) {
        if (pendingRevealItemId) {
          setIsPageTransitioning(true);
          setCurrentPageIndex((prev) => Math.min(latestReadablePageIndex, prev + 1));
        }
        return;
      }

      if (typingItemId) {
        revealTypingParagraph();
        return;
      }

      if (pendingRevealItemId) {
        if (currentPageIndex < latestReadablePageIndex) {
          setIsPageTransitioning(true);
          setCurrentPageIndex((prev) => prev + 1);
        }
        return;
      }

      if (canAdvance) {
        handleAdvance();
        return;
      }

      if (canRevealChoices && !choicesRevealed) {
        setChoicesRevealed(true);
        return;
      }

      if (isReadComplete) {
        setIsCompletingChapterExit(true);
      }
    };

    const handleNotebookBodyAdvance = (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      advanceNotebookBody();
    };

    const handleNotebookNextPage = () => {
      if (!canGoForwardPage) {
        return;
      }

      setIsPageTransitioning(true);
      setCurrentPageIndex((prev) => Math.min(reachablePageIndex, prev + 1));
    };

    const handleNotebookPrevPage = () => {
      if (!canGoPrevPage) {
        return;
      }

      setIsPageTransitioning(true);
      setCurrentPageIndex((prev) => Math.max(0, prev - 1));
    };

    const handleTutorialAdvance = () => {
      completeTutorialStep("advance");
      advanceNotebookBody();
    };

    const handleTutorialNextPage = () => {
      if (!canGoForwardPage) {
        return;
      }

      completeTutorialStep("nextPage");
      setTutorialAwaitingPrevPage(true);
      handleNotebookNextPage();
    };

    const handleTutorialPrevPage = () => {
      if (!canGoPrevPage) {
        return;
      }

      completeTutorialStep("prevPage");
      setTutorialAwaitingPrevPage(false);
      handleNotebookPrevPage();
    };

    return (
      <motion.div
        ref={notebookRootRef}
        className={`relative h-full w-full ${isCompletingChapterExit ? "pointer-events-none" : ""}`}
        initial={false}
        animate={{ opacity: isCompletingChapterExit ? 0 : 1 }}
        transition={{ duration: CHAPTER_EXIT_FADE_MS / 1000, ease: "easeOut" }}
      >
        <ScreenEdgeProgress progress={progressRatio} animateQuickly={Boolean(typingItemId)} />

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            notebookSpreadControls.onExit();
          }}
          className="group absolute left-[13.2%] top-[11.6%] z-30 inline-flex items-center gap-[0.55rem] bg-transparent px-1 py-1 font-chinese text-[0.98rem] tracking-[0.12em] text-[#6C3B0C] drop-shadow-[0_2px_10px_rgba(255,245,220,0.18)] transition-colors hover:text-[#8b4e14]"
        >
          <span className="inline-flex shrink-0 text-[#6C3B0C] transition-colors group-hover:text-[#8b4e14]">
            ←
          </span>
          <span>{notebookSpreadControls.backLabel}</span>
        </button>

        <div
          ref={notebookBodyRef}
          className="absolute left-[13.5%] top-[18%] z-30 h-[68%] w-[75.2%]"
          style={{ transform: "translateY(-8pt)" }}
          onClick={handleNotebookBodyAdvance}
        >
          <AnimatePresence mode="wait" initial={false} onExitComplete={() => setIsPageTransitioning(false)}>
            <motion.div
              key={currentPage.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={PAGE_TRANSITION}
              className="flex h-full w-full flex-col"
              style={{ rowGap: `${notebookParagraphGapPt}pt` }}
            >
              {currentPage.rows.map((row) =>
                row.kind === "spread" ? (
                  <div key={row.id} className="w-full">
                    {shouldHoldPendingImage(row.item) ? null : renderFlowItem(row.item)}
                  </div>
                ) : (
                  <div
                    key={row.id}
                    className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    style={{ columnGap: `${NOTEBOOK_COLUMN_GAP_PX}px` }}
                  >
                    {[row.left, row.right].map((columnItems, columnIndex) => (
                      <div
                        key={`${row.id}-${columnIndex}`}
                        className="flex min-h-0 flex-col"
                        style={{
                          rowGap: `${notebookParagraphGapPt}pt`,
                          transform: columnIndex === 1 ? "translateX(4pt)" : undefined,
                        }}
                      >
                        {columnItems.filter((flowItem) => !shouldHoldPendingImage(flowItem)).map((flowItem) => (
                          <React.Fragment key={flowItem.id}>{renderFlowItem(flowItem)}</React.Fragment>
                        ))}
                      </div>
                    ))}
                  </div>
                ),
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (tutorialStep === "prevPage") {
              completeTutorialStep("prevPage");
              setTutorialAwaitingPrevPage(false);
            }
            handleNotebookPrevPage();
          }}
          disabled={!canGoPrevPage}
          className={`absolute bottom-[7.6%] left-[13.5%] z-40 bg-transparent p-0 transition-all ${
            canGoPrevPage ? "hover:-translate-x-[2px] hover:-translate-y-[1px]" : "opacity-[0.28]"
          }`}
        >
          <img
            src={notebookSpreadControls.prevArrowSrc}
            alt=""
            className="pointer-events-none h-[clamp(2.9rem,2.3rem+1vw,4.25rem)] w-[clamp(2.9rem,2.3rem+1vw,4.25rem)] object-contain"
            draggable={false}
          />
        </button>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (tutorialStep === "nextPage") {
              completeTutorialStep("nextPage");
              setTutorialAwaitingPrevPage(true);
            }
            handleNotebookNextPage();
          }}
          disabled={!canGoForwardPage}
          style={{ marginRight: "-10pt" }}
          className={`absolute bottom-[7.6%] right-[13.2%] z-40 bg-transparent p-0 transition-all ${
            canGoForwardPage ? "hover:translate-x-[2px] hover:-translate-y-[1px]" : "opacity-[0.28]"
          }`}
        >
          <img
            src={notebookSpreadControls.nextArrowSrc}
            alt=""
            className="pointer-events-none h-[clamp(2.9rem,2.3rem+1vw,4.25rem)] w-[clamp(2.9rem,2.3rem+1vw,4.25rem)] object-contain"
            draggable={false}
          />
        </button>

        <AnimatePresence>
          {tutorialStep && (
            <TutorialOverlay
              key={tutorialStep}
              step={tutorialStep}
              copy={ui.tutorial}
              targetRect={tutorialStep === "choice" ? tutorialChoiceTargetRect : null}
              onAdvance={handleTutorialAdvance}
              onNextPage={handleTutorialNextPage}
              onPrevPage={handleTutorialPrevPage}
            />
          )}
        </AnimatePresence>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-[-9999px] top-0 z-[-1] opacity-0"
        >
          <div
            ref={notebookMeasureRef}
            className="flex flex-col"
            style={{
              width: `${measurementSpreadWidth}px`,
              rowGap: `${notebookParagraphGapPt}pt`,
            }}
          >
            {flowItems.map((flowItem) => (
              <div
                key={`measure-${flowItem.id}`}
                style={{
                  width: `${isSpreadFlowItem(flowItem) ? measurementSpreadWidth : measurementColumnWidth}px`,
                }}
              >
                {renderFlowItem(flowItem, true)}
              </div>
            ))}
          </div>
        </div>

        <style>{`
          .text-indent-2em {
            text-indent: 2em;
          }
        `}</style>
      </motion.div>
    );
  }

  return (
    <div
      ref={defaultScrollRef}
      className="mx-auto flex h-full w-full max-w-3xl cursor-pointer flex-col space-y-5 overflow-y-auto pr-3 sm:pr-4"
      onClick={() => {
        if (isPaused) {
          onPausedAdvanceAttempt?.();
          return;
        }

        if (canAdvance) {
          handleAdvance();
          return;
        }

        if (canRevealChoices && !choicesRevealed) {
          setChoicesRevealed(true);
        }
      }}
    >
      <div className="flex-1 space-y-3">{flowItems.map((flowItem) => renderFlowItem(flowItem))}</div>

      <style>{`
        .text-indent-2em {
          text-indent: 2em;
        }
      `}</style>
    </div>
  );
};
