import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateNotifier } from './pwa-update-notifier';

describe('<PwaUpdateNotifier />', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  let reloadMock: ReturnType<typeof vi.fn>;
  let waitingWorkerMock: Partial<ServiceWorker>;
  let serviceWorkerListeners: Record<string, EventListener> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    postMessageMock = vi.fn();
    reloadMock = vi.fn();
    serviceWorkerListeners = {};

    waitingWorkerMock = {
      postMessage: postMessageMock as unknown as ServiceWorker['postMessage'],
      state: 'installed',
    };

    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        reload: reloadMock,
      },
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      writable: true,
      value: {
        controller: {},
        addEventListener: vi.fn((event: string, cb: EventListener) => {
          serviceWorkerListeners[event] = cb;
        }),
        removeEventListener: vi.fn(),
        register: vi.fn().mockResolvedValue({
          waiting: waitingWorkerMock,
          addEventListener: vi.fn(),
          update: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });
  });

  it('renders update prompt when service worker has an update waiting', async () => {
    await act(async () => {
      render(<PwaUpdateNotifier />);
    });

    const updateHeading = await screen.findByText('Actualización disponible');
    expect(updateHeading).toBeDefined();

    const updateBtn = screen.getByRole('button', { name: /Actualizar/i });
    expect(updateBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(updateBtn);
    });
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('reloads page when controllerchange fires', async () => {
    await act(async () => {
      render(<PwaUpdateNotifier />);
    });

    const handler = serviceWorkerListeners['controllerchange'];
    expect(handler).toBeDefined();

    await act(async () => {
      handler?.(new Event('controllerchange'));
    });

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
