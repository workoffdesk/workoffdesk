import { createContext, useContext } from 'react';

// The agent of the session on screen, by the name its lines call it.
export const AgentName = createContext('Claude');
export const useAgentName = () => useContext(AgentName);
