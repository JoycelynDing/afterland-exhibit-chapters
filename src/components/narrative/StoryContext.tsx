import React, { createContext, useContext, ReactNode } from 'react';
import type { Story } from 'inkjs';
import { useInkStory, UseInkStoryProps } from '../../hooks/useInkStory';

interface StoryContextType {
  currentText: string[];
  currentChoices: any[];
  selectChoice: (index: number) => void;
  isEnded: boolean;
  turnCount: number;
  story: Story | null;
}

const StoryContext = createContext<StoryContextType | undefined>(undefined);

export const StoryProvider = ({ 
  children, 
  storyJson, 
  onTag,
  storageKey,
  initialPath,
}: { 
  children: ReactNode; 
  storyJson: any; 
  onTag?: UseInkStoryProps['onTag'];
  storageKey?: string;
  initialPath?: string;
}) => {
  const storyState = useInkStory({ storyJson, onTag, storageKey, initialPath });

  return (
    <StoryContext.Provider value={storyState}>
      {children}
    </StoryContext.Provider>
  );
};

export const useStory = () => {
  const context = useContext(StoryContext);
  if (!context) {
    throw new Error('useStory must be used within a StoryProvider');
  }
  return context;
};
