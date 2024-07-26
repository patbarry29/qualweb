import { BestPractice } from '@qualweb/best-practices';
import BestPracticeObject from '../lib/BestPractice.object';
import { BestPracticeClass, ElementExists } from '../lib/applicability';
import Test from '../lib/Test.object';
import { Translate } from '@qualweb/locale';

/**
* @name Chatbot provides voice output
* @description The chatbot can provide voice output
* HOW TO IMPLEMENT
*   - Send audio message to chatbot using pre-recorded audio
*   - When message is finished sending, turn on microphone and listen for a response
*/

@BestPracticeClass
class QW_BP32 extends BestPracticeObject {
  constructor(bestPractice: BestPractice, locale: Translate) {
    super(bestPractice, locale);
  }

  @ElementExists
  execute(element: typeof window.qwElement): void {
    const test = new Test();

    test.addElement(element);
    super.addTestResult(test);
  }
}

export = QW_BP32;