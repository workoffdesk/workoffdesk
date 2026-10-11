import type { Api } from '@workoffdesk/client/base/api';
import { LOADING, type Listed } from '@workoffdesk/client/base/listed';
import type { createGroupingChoice, createLanguageChoice, createThemeChoice, GroupingChoice, LanguageChoice, ThemeChoice } from '@workoffdesk/client/settings/choices';
import { fetchLogins, fetchPasskeys, type LoginRow, type PasskeyRow } from '@workoffdesk/client/settings/signIns';
import { t } from '@workoffdesk/i18n';
import { useEffect, useState } from 'react';

// The colours and the app's language, each this device's own: the names of the choices, the one in effect,
// and picking one. A language takes effect as the app starts again (`restart`).
export function useLooks(o: {
  themeChoice: ReturnType<typeof createThemeChoice>;
  setTheme: (v: ThemeChoice) => void;
  languageChoice: ReturnType<typeof createLanguageChoice>;
  restart: () => void;
}) {
  const [colours, setColoursShown] = useState(o.themeChoice.get());
  const themes: Record<ThemeChoice, string> = { system: t.followSystem, light: t.themeLight, dark: t.themeDark, eye: t.themeEye };
  const pickTheme = (v: ThemeChoice) => {
    o.setTheme(v);
    setColoursShown(v);
  };
  const language = o.languageChoice.get();
  const languages: Record<LanguageChoice, string> = { system: t.followSystem, zh: '中文', en: 'English' };
  const pickLanguage = (v: LanguageChoice) => {
    if (v === language) return;
    o.languageChoice.keep(v);
    o.restart();
  };
  return { colours, themes, pickTheme, language, languages, pickLanguage };
}

// How the session list is shown, this device's own: by project or as one list. Every page showing it follows a
// change at once (on the web, Settings is beside the list).
export function useGrouping(choice: ReturnType<typeof createGroupingChoice>) {
  const [grouping, setGrouping] = useState(choice.get());
  useEffect(() => choice.follow(setGrouping), [choice]);
  const groupings: Record<GroupingChoice, string> = { project: t.groupByProject, none: t.notGrouped };
  return { grouping, groupings, pickGrouping: (v: GroupingChoice) => choice.keep(v) };
}

// This server's passkeys and signed-in devices, loaded with the page and again after each change (`load`); a
// list that did not load is asked for again on its own (`retry…`).
export function useSignIns(api: Api) {
  const [passkeyList, setPasskeys] = useState<Listed<PasskeyRow>>(LOADING);
  const [loginList, setLogins] = useState<Listed<LoginRow>>(LOADING);
  const loadPasskeys = () => fetchPasskeys(api).then(setPasskeys);
  const loadLogins = () => fetchLogins(api).then(setLogins);
  const load = () => Promise.all([loadPasskeys(), loadLogins()]);
  useEffect(() => {
    void fetchPasskeys(api).then(setPasskeys);
    void fetchLogins(api).then(setLogins);
  }, [api]);
  const passkeys = passkeyList.state === 'loaded' ? passkeyList.rows : null;
  const logins = loginList.state === 'loaded' ? loginList.rows : null;
  const retryPasskeys = () => {
    setPasskeys(LOADING);
    void loadPasskeys();
  };
  const retryLogins = () => {
    setLogins(LOADING);
    void loadLogins();
  };
  return { passkeyList, loginList, passkeys, logins, load, retryPasskeys, retryLogins };
}
