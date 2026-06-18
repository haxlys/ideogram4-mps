import { createContext, useContext, useEffect, useReducer, useMemo, type Dispatch, type ReactNode } from "react";
import { appReducer, initialState, type AppState } from "./reducer";
import { loadQueueState, saveQueueState } from "./queueStorage";
import type { AppAction } from "./types";

function createInitialState(): AppState {
  const { genQueue, genQueueExpanded } = loadQueueState();
  return {
    ...initialState,
    genQueue,
    genQueueExpanded,
  };
}

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);

  useEffect(() => {
    saveQueueState(state.genQueue, state.genQueueExpanded);
  }, [state.genQueue, state.genQueueExpanded]);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}
