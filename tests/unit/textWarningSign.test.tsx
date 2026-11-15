/**
 * The warning sign in the shared Text component.
 *
 * Neither app font (Lato, Tajawal) has ⚠ (U+26A0), and iOS drew it as a boxed
 * "?" at the start of every "⚠ ..." string (Bark capsule status, Home backup
 * reminder, Bark settings, vault screens). On iOS the sign is now drawn on its
 * own in the system font, which has it, in a nested span that keeps the text's
 * size and colour. The string itself is unchanged, and so are the emoji form
 * (⚠️, with U+FE0F) and Android.
 */

import React from 'react';
import renderer, { act, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Platform, Text as RNText } from 'react-native';

import Text from '../../src/component-library/Text';

const render = (node: React.ReactElement): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(node);
  });
  return tree as ReactTestRenderer;
};

const outerText = (tree: ReactTestRenderer): ReactTestInstance => tree.root.findAllByType(RNText)[0];

const systemSpans = (tree: ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAllByType(RNText).filter(node => (node.props.style as { fontFamily?: string } | undefined)?.fontFamily === 'System');

// Everything the text shows, nested spans included, in order.
const shownText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(shownText).join(''));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Text warning sign', () => {
  it('draws a leading ⚠ in the system font on iOS, with the text weight', () => {
    const tree = render(<Text bold>⚠ On this phone only</Text>);

    const spans = systemSpans(tree);
    expect(spans).toHaveLength(1);
    expect(spans[0].props.children).toBe('⚠');
    expect(spans[0].props.style).toEqual({ fontFamily: 'System', fontWeight: '700' });
    expect(shownText(outerText(tree))).toBe('⚠ On this phone only');
  });

  it('matches the weight of the app font family', () => {
    expect(systemSpans(render(<Text>⚠ Experimental</Text>))[0].props.style).toEqual({
      fontFamily: 'System',
      fontWeight: '500', // Lato-Medium, the default
    });
    expect(systemSpans(render(<Text semibold>⚠ Experimental</Text>))[0].props.style).toEqual({
      fontFamily: 'System',
      fontWeight: '600',
    });
  });

  it('finds the sign in any string child and anywhere in it', () => {
    const tree = render(<Text>{'Note: '}⚠ Reminders are OFF. ⚠ Check</Text>);

    expect(systemSpans(tree)).toHaveLength(2);
    expect(shownText(outerText(tree))).toBe('Note: ⚠ Reminders are OFF. ⚠ Check');
  });

  it('leaves the emoji form and text without the sign as they are', () => {
    const emoji = render(<Text>⚠️ DO NOT transfer</Text>);
    expect(systemSpans(emoji)).toHaveLength(0);
    expect(outerText(emoji).props.children).toBe('⚠️ DO NOT transfer');

    const plain = render(<Text>✓ Backed up</Text>);
    expect(outerText(plain).props.children).toBe('✓ Backed up');
  });

  it('keeps the test id and accessibility label of the original string', () => {
    const outer = outerText(render(<Text>⚠ Back up to recover</Text>));

    expect(outer.props.testID).toBe('text⚠ Back up to recover');
    expect(outer.props.accessibilityLabel).toBe('text⚠ Back up to recover');
  });

  it('leaves Android unchanged', () => {
    jest.replaceProperty(Platform, 'OS', 'android');

    const tree = render(<Text bold>⚠ On this phone only</Text>);

    expect(systemSpans(tree)).toHaveLength(0);
    expect(outerText(tree).props.children).toBe('⚠ On this phone only');
  });
});
