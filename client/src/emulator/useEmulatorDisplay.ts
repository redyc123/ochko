import { useEffect, useMemo, useState } from 'react';

import type { EmulatorDevice } from './EmulatorDevice';
import { contentToPages } from './displayContent';
import { selectActiveContent, type EmulatorScreenState } from './screenState';

export function useEmulatorDisplay(device: EmulatorDevice) {
  const [screen, setScreen] = useState<EmulatorScreenState>(() => device.getScreenState());
  const [page, setPage] = useState(0);

  useEffect(() => device.onScreenChange(setScreen), [device]);

  const content = useMemo(() => selectActiveContent(screen), [screen]);
  const pages = useMemo(() => contentToPages(content), [content]);
  const currentPage = pages[page % pages.length] ?? [];

  // Сбрасываем страницу при смене типа контента прямо во время рендера,
  // чтобы не показывать кадр с чужой страницей.
  const [prevKind, setPrevKind] = useState(content.kind);
  if (prevKind !== content.kind) {
    setPrevKind(content.kind);
    setPage(0);
  }

  return {
    screen,
    content,
    pages,
    currentPage,
    nextPage: () => setPage((p) => p + 1),
  };
}
