import React, { useEffect, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import createCache from '@emotion/cache';
import { CacheProvider, ClassNames, Global } from '@emotion/react';

export function Probe({ cache }: { cache: ReturnType<typeof createCache> }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    document.body.dataset[`hydrated${cache.key}`] = 'true';
  }, [cache.key]);
  return (
    <CacheProvider value={cache}>
      <Global
        styles={{ [`[data-probe="${cache.key}"]`]: { '--probe-padding': '17px', border: '3px solid rgb(10, 20, 30)' } }}
      />
      <ClassNames>
        {({ css }) => (
          <button
            data-probe={cache.key}
            onClick={() => setCount((value) => value + 1)}
            className={css({
              color: 'rgb(30, 40, 50)',
              backgroundColor: 'rgb(230, 240, 250)',
              padding: 'var(--probe-padding)',
              width: 180,
              height: 64,
            })}
          >
            {cache.key} {count}
          </button>
        )}
      </ClassNames>
    </CacheProvider>
  );
}

export function InlineProbe({ cache }: { cache: ReturnType<typeof createCache> }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    document.body.dataset['hydratednative'] = 'true';
  }, []);
  const common = {
    color: 'var(--probe-tint)',
    backgroundColor: 'rgb(230, 240, 250)',
    padding: 'var(--probe-padding)',
    width: 180,
    height: 64,
  };
  return <CacheProvider value={cache}>
    {['rgb(210, 30, 40)', 'rgb(40, 30, 210)', 'rgb(210, 30, 40)'].map((color, index) => <Global key={index}
      styles={{ '[data-probe^="native-"]': { '--probe-tint': color, '--probe-padding': '17px', border: '3px solid rgb(10, 20, 30)' } }} />)}
    <ClassNames>{({ css }) => <button data-probe="native-one" className={`${css(common)} ${css({ fontWeight: 600 })}`}>First</button>}</ClassNames>
    <ClassNames>{({ css }) => <button data-probe="native-two" className={`${css(common)} ${css({ fontWeight: 600 })} ${css({ fontStyle: 'italic' })}`}
      onClick={() => setCount(value => value + 1)}>Second {count}</button>}</ClassNames>
  </CacheProvider>;
}

declare global {
  interface Window {
    hydrateEmotionProbe(): void;
  }
}
if (typeof window !== 'undefined') {
  const caches = ['css', 'site'].map((key) => createCache({ key }));
  const nativeCache = createCache({ key: 'native' });
  window.hydrateEmotionProbe = () => {
    for (const cache of caches) hydrateRoot(document.getElementById(`root-${cache.key}`)!, <Probe cache={cache} />);
    hydrateRoot(document.getElementById('root-native')!, <InlineProbe cache={nativeCache} />);
  };
}
