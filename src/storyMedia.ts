type LocalizedCopy = Record<"zh" | "en", string>;

export type StoryInlineImageLayout = "column" | "spread";

export interface StoryInlineImageAsset {
  src: string;
  layout?: StoryInlineImageLayout;
}

export interface StoryInlineImageInsertion {
  imageId: string;
  textIncludes: string;
  position: "before" | "after";
}

export interface StoryInlineImageConfig {
  assets: Record<string, StoryInlineImageAsset>;
  insertions?: StoryInlineImageInsertion[];
}

export type CollectibleClueId = string;

export interface CollectibleClueConfig {
  id: CollectibleClueId;
  imageSrc: string;
  description: LocalizedCopy;
  actionLabel: LocalizedCopy;
  hint: LocalizedCopy;
  storageKey: string;
  pendingStorageKey: string;
  unreadStorageKey: string;
  relicEntryId: string;
}

const copy = (zh: string, en: string): LocalizedCopy => ({ zh, en });

export const C001_RELIC_ID = "C001";
export const C002_RELIC_ID = "C002";

const storyImageModules = import.meta.glob("./assets/*.{png,PNG,jpg,JPG,jpeg,JPEG,webp,WEBP}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const normalizeStoryMediaId = (id: string) => id.trim().toUpperCase();

const getStoryMediaIdFromPath = (path: string) => {
  const fileName = path.split("/").pop() ?? path;
  return fileName.match(/([ABC]\d{3,})/i)?.[1]?.toUpperCase() ?? null;
};

const inferInlineLayout = (id: string): StoryInlineImageLayout => (id.startsWith("B") ? "spread" : "column");

export const isStoryMediaMarkerText = (line: string) => {
  const trimmed = line.trim();

  return Boolean(
    trimmed.match(/^\[\[\s*(?:IMG|IMAGE|CLUE)\s*:\s*([ABC]\d{3,})\s*\]\]$/i) ??
      trimmed.match(/^\[\[\s*([ABC]\d{3,})\s*\]\]$/i) ??
      trimmed.match(/^\[\s*([ABC]\d{3,})\s*\]$/i) ??
      trimmed.match(/^([ABC]\d{3,})$/i) ??
      trimmed.match(/^(?:图片|IMG|IMAGE|线索|CLUE)\s*[:：]?\s*([ABC]\d{3,})$/i),
  );
};

const STORY_MEDIA_ASSETS = Object.entries(storyImageModules).reduce<Record<string, string>>((assets, [path, src]) => {
  const id = getStoryMediaIdFromPath(path);

  if (!id) {
    return assets;
  }

  assets[id] = src;
  return assets;
}, {});

const STORY_INLINE_IMAGE_ASSETS = Object.fromEntries(
  Object.entries(STORY_MEDIA_ASSETS)
    .filter(([id]) => id.startsWith("A") || id.startsWith("B"))
    .map(([id, src]) => [id, { src, layout: inferInlineLayout(id) } satisfies StoryInlineImageAsset]),
);

const getStoryMediaAssetSrc = (id: string) => {
  const normalizedId = normalizeStoryMediaId(id);
  const src = STORY_MEDIA_ASSETS[normalizedId];

  if (!src) {
    console.warn(`Story media asset "${normalizedId}" was not found in src/assets.`);
  }

  return src ?? "";
};

const getDefaultClueDescription = (id: string) =>
  copy(`尚未记录描述的线索 ${id}。`, `A clue without a written description yet: ${id}.`);

const COLLECTIBLE_CLUE_OVERRIDES: Record<
  string,
  Partial<Pick<CollectibleClueConfig, "description" | "actionLabel" | "hint" | "relicEntryId">>
> = {
  C001: {
    description: copy(
      "一张磨损严重的旧照片。纸面被折痕贯穿，仍能辨认出少年惊讶的神情，像是某个被匆忙藏起的瞬间。",
      "A badly worn old photograph. Creases cut through the paper, but the boy's startled expression still remains, like a moment hidden in haste.",
    ),
    relicEntryId: "RL-01",
  },
  C002: {
    description: copy(
      "712年议庭张贴的公告，检举异常个体奖励十二银币，两月冬粮。",
      "A council notice posted in year 712: reporting an anomalous individual rewards twelve silver coins and two months of winter grain.",
    ),
    actionLabel: copy("自行阅读", "Read It Yourself"),
    relicEntryId: "RL-02",
  },
  C003: {
    description: copy(
      "记录了海尔萝德在312年7月之间去领过12银币以及2包冬粮的物资领取登记表",
      "A supply pickup ledger showing that Herlode collected 12 silver coins and 2 packs of winter grain in July 312.",
    ),
    relicEntryId: "RL-03",
  },
  C004: {
    description: copy(
      "母亲米兰·多尔尼的炊事人员档案",
      "Mother Mira Dorne's kitchen staff personnel file.",
    ),
    relicEntryId: "RL-04",
  },
  C005: {
    description: copy(
      "海尔萝德的人员档案",
      "Herlode's personnel file.",
    ),
    relicEntryId: "RL-05",
  },
  C006: {
    description: copy(
      "记录着7月巡逻追捕记录的纸页",
      "A page recording July patrol pursuit entries.",
    ),
    relicEntryId: "RL-06",
  },
  C007: {
    description: copy(
      "母亲去世那年罗夫伯教区十字口的公告存档",
      "The archived Rofberg Parish Crossroads notice from the year Mother died.",
    ),
    relicEntryId: "RL-07",
  },
};

const createCollectibleClueConfig = (id: string): CollectibleClueConfig => {
  const normalizedId = normalizeStoryMediaId(id);
  const override = COLLECTIBLE_CLUE_OVERRIDES[normalizedId] ?? {};
  const keySuffix = normalizedId.toLowerCase();

  return {
    id: normalizedId,
    imageSrc: getStoryMediaAssetSrc(normalizedId),
    description: override.description ?? getDefaultClueDescription(normalizedId),
    actionLabel: override.actionLabel ?? copy("贴入手札", "Paste into Journal"),
    hint: override.hint ?? copy("笔记本后好像有什么东西", "Something seems tucked behind the notebook"),
    storageKey: `afterland-relic-${keySuffix}-collected`,
    pendingStorageKey: `afterland-relic-${keySuffix}-pending`,
    unreadStorageKey: `afterland-relic-${keySuffix}-unread`,
    relicEntryId: override.relicEntryId ?? `RL-${normalizedId}`,
  };
};

export const COLLECTIBLE_CLUES: Record<CollectibleClueId, CollectibleClueConfig> = Object.fromEntries(
  Object.keys(STORY_MEDIA_ASSETS)
    .filter((id) => id.startsWith("C"))
    .sort()
    .map((id) => [id, createCollectibleClueConfig(id)]),
);

export const COLLECTIBLE_CLUE_IDS = Object.keys(COLLECTIBLE_CLUES) as CollectibleClueId[];

export const getCollectibleClue = (id: string | null | undefined) => {
  const normalizedId = id ? normalizeStoryMediaId(id) : "";
  return normalizedId ? COLLECTIBLE_CLUES[normalizedId] : undefined;
};

/**
 * 叙事图片类型：
 * A 型 / 速写：插入半屏单页；B 型 / 场景图：横跨左右页；C 型 / 线索：从笔记本后滑出的可收集线索。
 *
 * 推荐在 Ink/JSON 文本中单独一行写：
 * A001 或 [[IMG:A001]]  -> 半页速写
 * B001 或 [[IMG:B001]]  -> 跨页彩插
 * C001 或 [[CLUE:C001]] -> 弹出线索
 */
export const STORY_INLINE_IMAGE_COMPAT_INSERTIONS_BY_CHAPTER_ID: Record<string, StoryInlineImageInsertion[]> = {
  "CH-00": [
    {
      imageId: "A002",
      textIncludes: "他正在帐篷外面修一只旧水壶",
      position: "after",
    },
    {
      imageId: "A004",
      textIncludes: "我更喜欢去摸那些石头，看到了许多人们留下的东西",
      position: "after",
    },
    {
      imageId: "A003",
      textIncludes: "那画面多停了一会儿",
      position: "before",
    },
    {
      imageId: "A005",
      textIncludes: "那声音低低的，只是随口小哼的曲",
      position: "after",
    },
    {
      imageId: "A006",
      textIncludes: "回到营地的时候，柳正蹲在火塘摆弄他的新网兜",
      position: "before",
    },
  ],
  "CH-01": [
    {
      imageId: "A001",
      textIncludes: "有人在帐篷外抖毯子",
      position: "before",
    },
    {
      imageId: "B002",
      textIncludes: "里面比外面冷不少，一股旧纸和防虫药混在一起的味道扑出来",
      position: "before",
    },
    {
      imageId: "A007",
      textIncludes: "我透过两排档案之间的缝隙看见其中一个人的衣角",
      position: "before",
    },
  ],
  "CH-02": [
    {
      imageId: "B005",
      textIncludes: "那只被他抓住的尾猫此时已经没了动静，躺在一旁，身下缓缓流出红褐色的液体",
      position: "after",
    },
  ],
};

const STORY_INLINE_IMAGE_CONFIG_CACHE = new Map<string, StoryInlineImageConfig>();

export const getStoryInlineImageConfig = (chapterId: string): StoryInlineImageConfig => {
  const cachedConfig = STORY_INLINE_IMAGE_CONFIG_CACHE.get(chapterId);

  if (cachedConfig) {
    return cachedConfig;
  }

  const config = {
    assets: STORY_INLINE_IMAGE_ASSETS,
    insertions: STORY_INLINE_IMAGE_COMPAT_INSERTIONS_BY_CHAPTER_ID[chapterId],
  };

  STORY_INLINE_IMAGE_CONFIG_CACHE.set(chapterId, config);
  return config;
};

export const STORY_COLLECTIBLE_TRIGGERS_BY_CHAPTER_ID: Record<string, Array<{ id: string; textIncludes: string }>> = {
  "CH-01": [
    { id: C001_RELIC_ID, textIncludes: "那一眼很短" },
    {
      id: C002_RELIC_ID,
      textIncludes: "我向后翻，找到了712年的公告。纸面有点发旧，四周也有些破损，但文字保存得很好",
    },
  ],
};
