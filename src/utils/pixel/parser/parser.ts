import { Pixel } from '..';
import { PixelDOM, ParentNodeType, VComponentNode, Props } from '../pixelDom';
import { Stack } from '../utils';
import { EMOJI, PREFIXES } from './const';
import { TagParser } from './tagParser';

export default class PixelParser {
  tagRegExp = /<[a-zA-Z0-9\-!/](?:"[^"]*"|'[^']*'|[^'">])*>/g;

  componentRegExp = /<[\\/]?[A-Z\-!](?:"[^"]*"|'[^']*'|[^'">])*>/g;

  tagNameRegExp = /<\/?([^\s]+?)[/\s>]/;

  replaceRegExp = new RegExp(/{{([^{}]*)}}/g);

  pixelDOM: PixelDOM;

  tagParser: TagParser;

  instance: typeof Pixel;

  constructor(instance: typeof Pixel) {
    this.pixelDOM = new PixelDOM();
    this.tagParser = new TagParser(this);
    this.instance = instance;
  }

  parseHTML(html: string, parentComponent?: VComponentNode) {
    const stack = new Stack<ParentNodeType>();
    const reg = new RegExp(this.tagRegExp);

    if (parentComponent) {
      stack.push(parentComponent);
    }

    let el = null;
    do {
      el = reg.exec(html);
      if (el) {
        const tag = el[0];
        const { index } = el;

        const isComponent = this.isComponent(tag);
        const isXHTML = this.isXHTML(tag);

        if (isComponent) {
          const parentTag = stack.peek();
          const component = this.parseComponent(tag, parentComponent);
          const isArray: boolean = Array.isArray(component);

          if (isArray) {
            (component as VComponentNode[]).forEach((element) => {
              element.domEl = this.pixelDOM.mountNode(element);
            });
          } else {
            (component as VComponentNode).domEl = this.pixelDOM.mountNode(component as VComponentNode);
          }

          if (parentTag) {
            if (isArray) {
              parentTag.children.push(...(component as VComponentNode[]));
            } else {
              parentTag.children.push(component as VComponentNode);
            }
          } else {
            stack.push(component as VComponentNode);
          }
        } else if (isXHTML) {
          const { propHandlers, tagName, attrs } = this.tagParser.parse(tag, [], parentComponent);

          const element = this.pixelDOM.nodeFabric.createNode({ tagName, attrs, handlers: propHandlers });
          element.domEl = this.pixelDOM.mountNode(element);

          const parentTag = stack.peek();

          if (parentTag) {
            parentTag.children.push(element);
          }
        } else {
          const isOpen = tag[1] !== '/';

          if (!isOpen) {
            const closedTag = stack.pop();
            const parentTag = stack.peek();
            closedTag.domEl = this.pixelDOM.mountNode(closedTag);

            if (parentTag) {
              parentTag.children.push(closedTag);
            } else if (stack.isEmpty()) {
              stack.push(closedTag);
            }
          } else {
            const start = index + tag.trim().length;
            const nextChar = html[start];

            const { propHandlers, tagName, attrs } = this.tagParser.parse(tag, [], parentComponent);

            const element = this.pixelDOM.nodeFabric.createNode({ tagName, attrs, handlers: propHandlers });

            /* text node */
            if (nextChar && nextChar !== '<') {
              const text = html.slice(start, html.indexOf('<', start)).trim();
              this.parseText(text, parentComponent!, element);
            }
            stack.push(element);
          }
        }
      }
    } while (el);

    /* handle replace element without html tags */
    if (/^{{.+}}$/gi.test(html)) {
      this.parseText(html, parentComponent!, parentComponent!);
    }

    return stack.pop();
  }

  parseText(text: string, parentComponent: VComponentNode, parentNode: ParentNodeType) {
    if (text.length) {
      const emoji = new RegExp(/{{([^{}]*)}}/g);
      const reg = new RegExp(this.replaceRegExp);
      const prop = reg.exec(text);
      let replacedText = text;
      /* check for template replacement */
      if (prop && prop[0]) {
        const replaced = this.findPropInParent(prop[1], parentComponent) as Props;
        const stringValue = replaced ? replaced.toString() : '';
        let emojiReg = emoji.exec(stringValue);
        let emojiText = stringValue;

        /* checking for the presence of emoji in the template string */
        if (emojiReg && emojiReg[0]) {
          /* if the replacement is not at the beginning of the line create/mount textnode for this part */
          if (prop.index > 0) {
            this.handleTextNode(replacedText.substring(0, prop.index), parentNode);
          }

          do {
            if (emojiReg) {
              if (emojiReg.index > 0) {
                this.handleTextNode(emojiText.substring(0, emojiReg.index), parentNode);
                emojiText = emojiText.substring(emojiReg.index);
                this.handleEmoji(emojiReg[1].substring(1), parentNode, parentComponent);
              } else {
                this.handleEmoji(emojiReg[1].substring(1), parentNode, parentComponent);
              }
              emojiReg = emoji.exec(stringValue);
            }
          } while (emojiReg);
        } else {
          replacedText = text.replace(prop[0], stringValue);
          this.handleTextNode(replacedText, parentNode, prop[1]);
        }
      } else {
        this.handleTextNode(replacedText, parentNode);
      }
    }
  }

  handleTextNode(text: string, parentNode: ParentNodeType, usedProp?: string) {
    const textNode = this.pixelDOM.nodeFabric.createText({ text });
    textNode.usedProps.add(usedProp!);
    textNode.parent = parentNode;
    textNode.domEl = this.pixelDOM.mountTextNode(textNode) as Text;
    parentNode.children.push(textNode);
  }

  handleEmoji(emojiName: string, parentNode: ParentNodeType, parentComponent: VComponentNode) {
    const { propHandlers, tagName, attrs } = this.tagParser.parse(EMOJI[emojiName], [], parentComponent);

    const emojiNode = this.pixelDOM.nodeFabric.createNode({ tagName, attrs, handlers: propHandlers });

    emojiNode.parent = parentNode;
    emojiNode.domEl = this.pixelDOM.mountNode(emojiNode);
    parentNode.children.push(emojiNode);
  }

  parseComponent(tag: string, parentComponent?: VComponentNode): VComponentNode | VComponentNode[] {
    /* eslint no-unused-vars: "off" */
    const [_, componentName] = tag.match(this.tagNameRegExp)!;

    const {
      template,
      components,
      state,
      usedProps = [],
      methods,
      componentDidMount,
      pixelStore,
    } = this.instance.components[componentName]();

    const [firstTag, ...tags] = template.match(this.tagRegExp);

    if (components) {
      this.instance.registerComponents(components);
    }

    const isLoop = tag.indexOf('loop:');

    if (isLoop !== -1) {
      return this.loopHandler({ isLoop, componentName, parentComponent, tag });
    }

    const start = firstTag.length;
    const end = template.trim().length - tags[tags.length - 1].length;

    const parsedData = this.tagParser.parse(firstTag, usedProps, parentComponent, tag);

    const component = this.pixelDOM.nodeFabric.createComponent({
      ...parsedData,
      template: `${template.trim().substring(start, end)}`,
      state,
      methods,
      usedProps: parsedData.usedPropsList,
      parserInstant: this,
      componentDidMount,
      pixelStore,
      componentName,
    });

    return this.parseHTML(`${template.trim().substring(start, end)}`, component);
  }

  loopHandler = (config: any) => {
    const { isLoop, parentComponent, tag, componentName } = config;
    const { template, state, usedProps, methods } = this.instance.components[componentName]();
    const [firstTag, ...tags] = template.match(this.tagRegExp);

    const components: VComponentNode[] = [];
    const arrayName = tag.substring(isLoop + PREFIXES.LOOP.length).split(' ')[0];

    const start = firstTag.length;
    const end = template.trim().length - tags[tags.length - 1].length;

    const renderData = parentComponent && this.findPropInParent(arrayName, parentComponent);

    if (renderData) {
      renderData.forEach((element: Record<string, Props>) => {
        const parsedData = this.tagParser.parse(firstTag, usedProps, parentComponent, tag);
        const component = this.pixelDOM.nodeFabric.createComponent({
          ...parsedData,
          props: { ...parsedData.props, ...element },
          state,
          methods,
          template,
          parserInstant: this,
          componentName,
          usedProps: parsedData.usedPropsList,
        });
        components.push(this.parseHTML(`${template.trim().substring(start, end)}`, component) as VComponentNode);
      });
    }

    return components;
  };

  findPropInParent = (prop: string, component: VComponentNode) => {
    if (component.pixelStore.has(prop)) {
      return this.instance.store.store[prop];
    }

    if (prop in component.props) {
      return component.props[prop];
    }

    if (prop in component.state) {
      return component.state[prop];
    }

    return null;
  };

  /* eslint consistent-return: "off" */
  parseObjectPath = (props: Props, path: string) => {
    try {
      const clearPath = path.substring(2, path.length - 2).trim();
      const keys = clearPath.split('.');

      let result = props;

      for (const key of keys) {
        const value = result[key];

        if (!value) {
          return '';
        }
        result = value as Props;
      }
      return result;
    } catch (error) {
      console.error(error);
    }
  };

  isComponent = (tag: string) => tag.match(this.componentRegExp);

  isXHTML = (tag: string) => tag[tag.length - 2] === '/';
}
