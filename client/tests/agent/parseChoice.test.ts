import { parseChoice } from '../../src/agent/parseChoice';

describe('parseChoice', () => {
  it.each([
    ['второй', 1],
    ['Давай первый.', 0],
    ['номер 3', 2],
    ['3', 2],
    ['последний', 3],
    ['четвёртый вариант', 3],
  ])('«%s» → индекс %i', (text, index) => {
    expect(parseChoice(text, 4)).toEqual({ kind: 'index', index });
  });

  it('отмена', () => {
    expect(parseChoice('отмена', 3)).toEqual({ kind: 'cancel' });
    expect(parseChoice('не надо', 3)).toEqual({ kind: 'cancel' });
  });

  it('номер вне списка — null', () => {
    expect(parseChoice('пятый', 3)).toBeNull();
    expect(parseChoice('7', 3)).toBeNull();
  });

  it('длинная фраза или другое слово — решает модель', () => {
    expect(parseChoice('нет, тот который на Тверской улице', 3)).toBeNull();
    expect(parseChoice('Тверская', 3)).toBeNull();
    // «второй» как часть слова не должен срабатывать
    expect(parseChoice('вторник', 3)).toBeNull();
  });
});
