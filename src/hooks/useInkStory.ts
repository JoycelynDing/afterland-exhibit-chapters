import { useState, useCallback, useEffect } from 'react';
import { Story } from 'inkjs';

export interface InkChoice {
  text: string;
  index: number;
}

export interface UseInkStoryProps {
  storyJson: any;
  onTag?: (tag: string, value: string | null) => void;
  storageKey?: string;
  initialPath?: string;
}

interface PersistedInkSnapshot {
  storyStateJson: string;
  currentText: string[];
  currentChoices: InkChoice[];
  isEnded: boolean;
  turnCount: number;
}

/**
 * useInkStory Hook
 * Encapsulates inkjs logic for React components.
 */
export const useInkStory = ({ storyJson, onTag, storageKey, initialPath }: UseInkStoryProps) => {
  const [story, setStory] = useState<Story | null>(null);
  const [currentText, setCurrentText] = useState<string[]>([]);
  const [currentChoices, setCurrentChoices] = useState<InkChoice[]>([]);
  const [isEnded, setIsEnded] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  
  const processTags = useCallback((tags: string[]) => {
    if (!onTag) return;
    
    tags.forEach(tag => {
      // Split tag by colon (e.g., "add_item: key")
      const parts = tag.split(':').map(s => s.trim());
      const key = parts[0];
      const value = parts.length > 1 ? parts[1] : null;
      onTag(key, value);
    });
  }, [onTag]);

  const persistSnapshot = useCallback(
    (
      storyInstance: Story,
      nextText: string[],
      nextChoices: InkChoice[],
      nextIsEnded: boolean,
      nextTurnCount: number,
    ) => {
      if (!storageKey) return;

      const snapshot: PersistedInkSnapshot = {
        storyStateJson: storyInstance.state.ToJson(),
        currentText: nextText,
        currentChoices: nextChoices,
        isEnded: nextIsEnded,
        turnCount: nextTurnCount,
      };

      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    },
    [storageKey],
  );

  const continueStory = useCallback((storyInstance: Story) => {
    const textLines: string[] = [];
    
    // inkjs pattern to consume all lines until a choice or end
    while (storyInstance.canContinue) {
      const line = storyInstance.Continue();
      if (line) textLines.push(line.trim());
      
      // Process tags associated with the current line
      if (storyInstance.currentTags && storyInstance.currentTags.length > 0) {
        processTags(storyInstance.currentTags);
      }
    }

    const nextChoices = storyInstance.currentChoices.map(choice => ({
        text: choice.text,
        index: choice.index
      }));
    const nextIsEnded = !storyInstance.canContinue && storyInstance.currentChoices.length === 0;

    setCurrentText(textLines);
    setCurrentChoices(nextChoices);
    setIsEnded(nextIsEnded);
    setTurnCount(prev => {
      const nextTurnCount = prev + 1;
      persistSnapshot(storyInstance, textLines, nextChoices, nextIsEnded, nextTurnCount);
      return nextTurnCount;
    });
  }, [persistSnapshot, processTags]);

  // Initialize story
  useEffect(() => {
    if (!storyJson) {
      return;
    }

    try {
      const newStory = new Story(storyJson);
      setStory(newStory);

      if (storageKey) {
        const persistedRaw = window.localStorage.getItem(storageKey);
        if (persistedRaw) {
          try {
            const snapshot = JSON.parse(persistedRaw) as Partial<PersistedInkSnapshot>;
            if (typeof snapshot.storyStateJson === "string") {
              newStory.state.LoadJson(snapshot.storyStateJson);
              setCurrentText(Array.isArray(snapshot.currentText) ? snapshot.currentText : []);
              setCurrentChoices(Array.isArray(snapshot.currentChoices) ? snapshot.currentChoices : []);
              setIsEnded(Boolean(snapshot.isEnded));
              setTurnCount(typeof snapshot.turnCount === "number" ? snapshot.turnCount : 0);
              return;
            }
          } catch (error) {
            console.warn("Failed to restore Ink story snapshot:", error);
            window.localStorage.removeItem(storageKey);
          }
        }
      }

      setCurrentText([]);
      setCurrentChoices([]);
      setIsEnded(false);
      setTurnCount(0);

      if (initialPath) {
        newStory.ChoosePathString(initialPath);
      }

      continueStory(newStory);
    } catch (error) {
      console.error("Failed to initialize Ink story:", error);
    }
  }, [continueStory, initialPath, storageKey, storyJson]);

  const selectChoice = useCallback((index: number) => {
    if (!story) return;
    
    try {
      story.ChooseChoiceIndex(index);
      continueStory(story);
    } catch (error) {
      console.error("Error selecting choice:", error);
    }
  }, [story, continueStory]);

  // Observer for global variables (if needed)
  const getVariable = useCallback((name: string) => {
    return story?.variablesState && (story.variablesState as any)[name];
  }, [story]);

  return {
    currentText,
    currentChoices,
    selectChoice,
    isEnded,
    turnCount,
    getVariable,
    story 
  };
};
