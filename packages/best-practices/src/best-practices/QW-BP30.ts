import { BestPractice } from '@qualweb/best-practices';
import BestPracticeObject from '../lib/BestPractice.object';
import { BestPracticeClass, ElementExists } from '../lib/applicability';
import Test from '../lib/Test.object';
import { Translate } from '@qualweb/locale';

@BestPracticeClass
class QW_BP30 extends BestPracticeObject {
  constructor(bestPractice: BestPractice, locale: Translate) {
    super(bestPractice, locale);
  }

  @ElementExists
  execute(element: typeof window.qwElement): void {
    const test = new Test();

    if (this.checkForPotentialMicrophoneUsage()) {
      test.verdict = 'passed';
      test.resultCode = 'P1';
      test.description = 'The page potentially requests or uses microphone access.';
    } else {
      test.verdict = 'failed';
      test.resultCode = 'F1';
      test.description = 'No indication of microphone usage found on the page.';
    }

    test.addElement(element);
    super.addTestResult(test);
  }

  private checkForPotentialMicrophoneUsage(): boolean {
    // Check for the presence of APIs commonly used for microphone access
    const hasMediaDevices = 'mediaDevices' in navigator;
    const hasGetUserMedia = 'getUserMedia' in navigator || 
                            ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices);
    const hasWebkitGetUserMedia = 'webkitGetUserMedia' in navigator;
    const hasMozGetUserMedia = 'mozGetUserMedia' in navigator;

    // Check for elements commonly associated with audio input
    const hasAudioElement = document.querySelector('audio') !== null;
    const hasVideoElement = document.querySelector('video') !== null;
    const hasMediaRecorder = 'MediaRecorder' in window;

    // Check for WebRTC-related APIs
    const hasRTCPeerConnection = 'RTCPeerConnection' in window;
    const hasWebkitRTCPeerConnection = 'webkitRTCPeerConnection' in window;
    const hasMozRTCPeerConnection = 'mozRTCPeerConnection' in window;

    // Check for specific attributes or patterns in the DOM that might indicate microphone usage
    const hasMicrophoneAttribute = document.querySelector('[microphone], [data-microphone]') !== null;
    const hasAudioInputPattern = /getUserMedia|captureStream|microphone/i.test(document.body.innerHTML);

    return hasMediaDevices || hasGetUserMedia || hasWebkitGetUserMedia || hasMozGetUserMedia ||
           hasAudioElement || hasVideoElement || hasMediaRecorder ||
           hasRTCPeerConnection || hasWebkitRTCPeerConnection || hasMozRTCPeerConnection ||
           hasMicrophoneAttribute || hasAudioInputPattern;
  }
}

export = QW_BP30;