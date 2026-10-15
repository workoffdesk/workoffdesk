import { createContext, useContext } from 'react';

// The Claude conversation the chat on screen shows, when it shows one: its sub-agents are found under it.
export const ClaudeConversation = createContext<string | null>(null);
export const useClaudeConversation = () => useContext(ClaudeConversation);
