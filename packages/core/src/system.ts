'use strict';

import puppeteer, { Browser, Page, Viewport } from 'puppeteer';
import { Parser } from 'htmlparser2';
import DomHandler, { Node } from 'domhandler';
import * as DomUtils from 'domutils';
import CSSselect from 'css-select';
import { EvaluationReport, QualwebOptions, PageOptions, SourceHtml } from '@qualweb/core';
import { getFileUrls, crawlDomain } from './lib/managers/startup.manager';
import { evaluate } from './lib/managers/module.manager';
import { EarlOptions, EarlReport, generateEARLReport } from '@qualweb/earl-reporter';
import clone from 'lodash.clone';
import css from 'css';

import {
  DEFAULT_DESKTOP_USER_AGENT,
  DEFAULT_MOBILE_USER_AGENT,
  DEFAULT_DESKTOP_PAGE_VIEWPORT_WIDTH,
  DEFAULT_DESKTOP_PAGE_VIEWPORT_HEIGHT,
  DEFAULT_MOBILE_PAGE_VIEWPORT_WIDTH,
  DEFAULT_MOBILE_PAGE_VIEWPORT_HEIGHT
} from './lib/constants';

class System {

  private urls: Array<string>;
  private evaluations: {[url: string]: EvaluationReport};
  private force: boolean;
  private numberOfParallelEvaluations = 1;
  private modulesToExecute: any;

  private browser: Browser | null = null;

  constructor() {
    this.urls = new Array<string>();
    this.evaluations = {};
    this.force = false;
    this.modulesToExecute = {
      act: true,
      html: true,
      css: true,
      bp: true,
      wappalyzer: false
    };
  }

  public async start(): Promise<void> {
    this.browser = await puppeteer.launch({
      ignoreHTTPSErrors: true,
      headless: true,
      args: ['--no-sandbox']
    });
  }

  public async update(options: QualwebOptions): Promise<void> {
    this.urls = new Array<string>();
    this.evaluations = {};
    
    if (options.url) {
      this.urls.push(decodeURIComponent(options.url).trim());
    } 
    if (options.urls) {
      this.urls = this.urls.concat(options.urls.map((url: string) => decodeURIComponent(url).trim()));
    } 
    if (options.file) {
      this.urls = this.urls.concat(await getFileUrls(options.file));
    } 
    if (options.crawl) {
      this.urls = this.urls.concat(await crawlDomain(options.crawl));
    } 
    
    if (this.urls.length === 0) {
      throw new Error('Invalid input method');
    }

    if (options.maxParallelEvaluations !== undefined) {
      this.numberOfParallelEvaluations = parseInt(options.maxParallelEvaluations.toString(), 0);
      if (!Number.isInteger(this.numberOfParallelEvaluations) || this.numberOfParallelEvaluations < 1) {
        throw new Error('Invalid MaxParallelEvaluations value');
      }
    }

    if (this.urls.length < this.numberOfParallelEvaluations) {
      this.numberOfParallelEvaluations = this.urls.length;
    }

    if (options.force) {
      this.force = !!options.force;
    } else {
      this.force = false;
    }

    if (options.execute) {
      this.modulesToExecute.act = options.execute.act ? options.execute.act : false;
      this.modulesToExecute.html = options.execute.html ? options.execute.html : false;
      this.modulesToExecute.css = options.execute.css ? options.execute.css : false;
      this.modulesToExecute.bp = options.execute.bp ? options.execute.bp : false;
      this.modulesToExecute.wappalyzer = options.execute.wappalyzer ? options.execute.wappalyzer : false;
    } else {
      this.modulesToExecute = {
        act: true,
        html: true,
        css: true,
        bp: true,
        wappalyzer: false
      };
    }
  }

  public async execute(options: QualwebOptions): Promise<void> {
    for (let i = 0 ; i < this.urls.length ; i += this.numberOfParallelEvaluations) {
      const promises = new Array<any>();
      for (let j = 0 ; j < this.numberOfParallelEvaluations && i + j < this.urls.length ; j++) {
        promises.push(this.runModules(this.urls[i + j], options));
      }
      await Promise.all(promises);
    }
  }

  public async report(earl: boolean, options?: EarlOptions): Promise<{[url: string]: EvaluationReport} | {[url: string]: EarlReport}> {
    if (earl || options) {
      return generateEARLReport(this.evaluations, options);
    } else {
      return this.evaluations;
    }
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private async runModules(url: string, options: QualwebOptions): Promise<void> {
    if (this.browser) {
      let page: Page | undefined = undefined;
      try {
        page = await this.browser.newPage();
        //await page.setBypassCSP(true);
        await this.setPageViewport(page, options.viewport);

        const plainStylesheets: any = {};
        page.on('response', async response => {
          if(response.request().resourceType() === 'stylesheet') {
            const responseUrl = response.url();
            const content = await response.text();
            plainStylesheets[responseUrl] = content;
          }
        });

        const response = await page.goto(url, {
          timeout: 0,
          waitUntil: ['networkidle2', 'domcontentloaded']
        });

        if (response) {
          const sourceHtml = await this.parseSourceHTML(await response.text());
          const styles = CSSselect('style', sourceHtml.html.parsed);
          let k = 0;
          for (const style of styles || []) {
            if (style['children'] && style['children'][0]) {
              plainStylesheets['html' + k] = style['children'][0]['data'];
            }
            k++;
          }
          const stylesheets = await this.parseStylesheets(plainStylesheets);
          const mappedDOM = {};
          const cookedStew = CSSselect('*', sourceHtml.html.parsed);
          
          if (cookedStew.length > 0) {
            for (const item of cookedStew || []) {
              if (item['startIndex']) {
                mappedDOM[item['startIndex']] = item;
              }
            }
          }
          
          await this.mapCSSElements(sourceHtml.html.parsed, stylesheets, mappedDOM);

          const evaluation = await evaluate(url, sourceHtml, page, stylesheets, mappedDOM, this.modulesToExecute, options);

          this.evaluations[url] = evaluation.getFinalReport();
        } else {
          throw new Error('Error trying to reach webpage.');
        }
      } catch(err) {
        if (!this.force) {
          console.error(err);
        }
      } finally {
        if (page) {
          await page.close();
        }
      }
    }
  }

  private async setPageViewport(page: Page, options?: PageOptions): Promise<void> {
    if (options) {
      if (options.userAgent) {
        await page.setUserAgent(options.userAgent);
      } else if (options.mobile) {
        await page.setUserAgent(DEFAULT_MOBILE_USER_AGENT);
      } else {
        await page.setUserAgent(DEFAULT_DESKTOP_USER_AGENT);
      }

      const viewPort: Viewport = {
        width: options.mobile ? DEFAULT_MOBILE_PAGE_VIEWPORT_WIDTH : DEFAULT_DESKTOP_PAGE_VIEWPORT_WIDTH,
        height: options.mobile ? DEFAULT_MOBILE_PAGE_VIEWPORT_HEIGHT : DEFAULT_DESKTOP_PAGE_VIEWPORT_HEIGHT
      };
      if (options.resolution) {
        if (options.resolution.width) {
          viewPort.width = options.resolution.width;
        }
        if (options.resolution.height) {
          viewPort.height = options.resolution.height;
        }
      }
      viewPort.isMobile = !!options.mobile;
      viewPort.isLandscape = options.landscape !== undefined ? options.landscape : viewPort.width > viewPort.height;
      viewPort.hasTouch = !!options.mobile;

      await page.setViewport(viewPort);
    } else {
      await page.setViewport({
        width: DEFAULT_DESKTOP_PAGE_VIEWPORT_WIDTH,
        height: DEFAULT_DESKTOP_PAGE_VIEWPORT_HEIGHT,
        isMobile: false,
        hasTouch: false,
        isLandscape: true
      });
    }
  }

  private async parseStylesheets(plainStylesheets: any): Promise<any[]> {
    const stylesheets = new Array<any>();
    for (const file in plainStylesheets || {}){
      const stylesheet: any = { file, content: {} };
      if (stylesheet.content) {
        stylesheet.content.plain = plainStylesheets[file];
        stylesheet.content.parsed = css.parse(plainStylesheets[file], { silent: true }); //doesn't throw errors
        stylesheets.push(clone(stylesheet));
      }
    }

    return stylesheets;
  }

  private async parseSourceHTML(html: string): Promise<SourceHtml> {
    
    const sourceHTML: string = html.trim();

    const parsedHTML = this.parseHTML(sourceHTML);

    const elements = CSSselect('*', parsedHTML);

    let title = '';

    const titles = CSSselect('title', parsedHTML);

    if (titles.length > 0) {
      title = DomUtils.getText(titles[0]);
    }

    const source: SourceHtml = {
      html: {
        plain: sourceHTML,
        parsed: parsedHTML
      },
      elementCount: elements.length,
      title: title !== '' ? title : undefined
    }

    return source;
  }

  private parseHTML(html: string): Node[] {
    const handler = new DomHandler(() => {}, { withStartIndices: true, withEndIndices: true });
    const parser = new Parser(handler);
    parser.write(html.replace(/(\r\n|\n|\r|\t)/gm, ''));
    parser.end();

    return handler.dom;
  }

  private async mapCSSElements(dom: Node[], styleSheets: any, mappedDOM: any): Promise<void> {
    for (const styleSheet of styleSheets || []) {
      if (styleSheet.content && styleSheet.content.plain) {
        this.analyseAST(dom, styleSheet.content.parsed, undefined, mappedDOM);
      }
    }
  }

  private analyseAST(dom: Node[], cssObject: any, parentType: string | undefined, mappedDOM: any): void {
    if (cssObject === undefined ||
      cssObject['type'] === 'comment' ||
      cssObject['type'] === 'keyframes' ||
      cssObject['type'] === 'import') {
      return;
    }
    if (cssObject['type'] === 'rule' || cssObject['type'] === 'font-face' || cssObject['type'] === 'page') {
      this.loopDeclarations(dom, cssObject, parentType, mappedDOM);
    } else {
      if (cssObject['type'] === 'stylesheet') {
        for (const key of cssObject['stylesheet']['rules'] || []) {
          this.analyseAST(dom, key, undefined, mappedDOM);
        }
      } else {
        for (const key of cssObject['rules'] || []) {
          if (cssObject['type'] && cssObject['type'] === 'media') {
            this.analyseAST(dom, key, cssObject[cssObject['type']], mappedDOM);
          } else {
            this.analyseAST(dom, key, undefined, mappedDOM);
          }
        }
      }
    }
  }

  private loopDeclarations(dom: Node[], cssObject: any, parentType: string | undefined, mappedDOM: any): void {
    const declarations = cssObject['declarations'];
    if (declarations && cssObject['selectors'] && !cssObject['selectors'].toString().includes('@-ms-viewport') && !(cssObject['selectors'].toString() === ':focus')) {
      try {
        let stewResult = CSSselect(cssObject['selectors'].toString(), dom);
        if (stewResult.length > 0) {
          for (const item of stewResult || []) {
            if (item['startIndex']) {
              for (const declaration of declarations || []) {
                if (declaration['property'] && declaration['value']) {
                  if (!item['attribs']) {
                    item['attribs'] = {};
                  }
                  if (!item['attribs']['css']) {
                    item['attribs']['css'] = {};
                  }
                  if (item['attribs']['css'][declaration['property']] && item['attribs']['css'][declaration['property']]['value'] &&
                    item['attribs']['css'][declaration['property']]['value'].includes('!important')) {
                    continue;
                  }
                  else {
                    item['attribs']['css'][declaration['property']] = {};
                    if (parentType) {
                      item['attribs']['css'][declaration['property']]['media'] = parentType;
                    }
                    item['attribs']['css'][declaration['property']]['value'] = declaration['value'];
                  }
                  mappedDOM[item['startIndex']] = item;
                }
              }
            }
          }
        }
      }
      catch (err) {
        
      }
    }
  }
}

export = System;