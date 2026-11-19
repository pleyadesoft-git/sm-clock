'use client';

/**
 * Reproduce un timbre armónico estilo iOS (dos tonos cálidos C5 -> G5)
 * utilizando Web Audio API sin requerir archivos MP3 externos.
 */
export function playNotificationChime(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioCtx) {
      resolve();
      return;
    }

    try {
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.22, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      // Doble tono ascendente (523.25 Hz C5 -> 783.99 Hz G5)
      playTone(523.25, now, 0.18);
      playTone(783.99, now + 0.16, 0.28);

      setTimeout(() => {
        void ctx.close().catch(() => {});
        resolve();
      }, 460);
    } catch {
      resolve();
    }
  });
}

/**
 * Reproduce un aviso de voz dinámico personalizado (Text-to-Speech es-MX)
 * precedido por el timbre de notificación.
 */
export async function speakPersonalizedPunchNotification(
  textoVoz: string,
  options?: { playChime?: boolean; rate?: number; pitch?: number },
): Promise<boolean> {
  const shouldPlayChime = options?.playChime ?? true;
  if (shouldPlayChime) {
    await playNotificationChime();
  }

  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof window.SpeechSynthesisUtterance === 'undefined'
  ) {
    return false;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(textoVoz);
    utterance.lang = 'es-MX';
    utterance.rate = options?.rate ?? 1.0;
    utterance.pitch = options?.pitch ?? 1.0;

    const voices = window.speechSynthesis.getVoices();
    const mxVoice =
      voices.find((v) => v.lang.toLowerCase().includes('es-mx')) ??
      voices.find((v) => v.lang.toLowerCase().startsWith('es'));

    if (mxVoice) {
      utterance.voice = mxVoice;
    }

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
