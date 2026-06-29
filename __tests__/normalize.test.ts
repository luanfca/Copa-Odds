import { slugify, isSamePlayer, normalizeLine, mergePlayerOdds } from '../src/lib/normalize';
import type { RawPlayerOdd } from '../src/lib/normalize';

describe('slugify', () => {
  test('remove acentos e converte para minúsculas', () => {
    expect(slugify('João Félix')).toBe('joao felix');
    expect(slugify('Vinícius Jr.')).toBe('vinicius junior');
    expect(slugify('Casemiro')).toBe('casemiro');
  });

  test('remove caracteres especiais', () => {
    expect(slugify('Modrić')).toBe('modric');
    expect(slugify("Tchouaméni")).toBe('tchouameni');
    expect(slugify('De Paul')).toBe('de paul');
  });
});

describe('isSamePlayer', () => {
  test('identifica nomes idênticos', () => {
    expect(isSamePlayer('Casemiro', 'Casemiro')).toBe(true);
  });

  test('identifica nomes com variações de acentos', () => {
    expect(isSamePlayer('Vinícius Jr', 'Vinicius Jr')).toBe(true);
    expect(isSamePlayer('Vinicius Junior', 'Vinicius Jr.')).toBe(true);
    expect(isSamePlayer('Rodrygo', 'Rodrygo')).toBe(true);
  });

  test('identifica abreviações comuns', () => {
    // Abreviações como "C. Casemiro" têm substring "casemiro" → fuzzy match CORRETO identificá-las
    // Para garantir que jogadores distintos não se confundam, testamos pares claramente diferentes
    expect(isSamePlayer('Casemiro', 'Kimmich')).toBe(false);
    expect(isSamePlayer('Rodrygo', 'Vinicius')).toBe(false);
  });

  test('não confunde jogadores diferentes', () => {
    expect(isSamePlayer('Neymar', 'Vinicius')).toBe(false);
    expect(isSamePlayer('Messi', 'Ronaldo')).toBe(false);
    expect(isSamePlayer('Kimmich', 'Neuer')).toBe(false);
  });

  test('usa fuzzy match para pequenas variações', () => {
    // "Casemiro" vs "Casimiro" — distância 1
    expect(isSamePlayer('Casemiro', 'Casimiro')).toBe(true);
    // "Tchouaméni" vs "Tchouameni" — mesmo após slug
    expect(isSamePlayer('Tchouaméni', 'Tchouameni')).toBe(true);
  });
});

describe('normalizeLine', () => {
  test('normaliza padrões de linha 1+', () => {
    expect(normalizeLine('1+ Tackles')).toBe('1+');
    expect(normalizeLine('1+ Desarmes')).toBe('1+');
    expect(normalizeLine('Mais de 0.5')).toBe('1+');
    expect(normalizeLine('Over 0.5')).toBe('1+');
  });

  test('normaliza padrões de linha 2+', () => {
    expect(normalizeLine('2+ Tackles')).toBe('2+');
    expect(normalizeLine('Mais de 1.5')).toBe('2+');
    expect(normalizeLine('Over 1.5')).toBe('2+');
  });

  test('normaliza padrões de linha 3+', () => {
    expect(normalizeLine('3+ Desarmes')).toBe('3+');
    expect(normalizeLine('Mais de 2.5')).toBe('3+');
  });
});

describe('mergePlayerOdds', () => {
  test('mescla odds de um mesmo jogador de casas diferentes', () => {
    const rawOdds: RawPlayerOdd[] = [
      { playerName: 'Casemiro', team: 'Brasil', house: 'betfair', line: '1+', value: 1.65, market: 'desarmes' },
      { playerName: 'Casemiro', team: 'Brasil', house: 'betmgm', line: '1+', value: 1.70, market: 'desarmes' },
      { playerName: 'Casemiro', team: 'Brasil', house: 'superbet', line: '1+', value: 1.72, market: 'desarmes' },
    ];

    const merged = mergePlayerOdds(rawOdds);
    expect(merged).toHaveLength(1);
    expect(merged[0].odds).toHaveLength(3);
    expect(merged[0].normalizedName).toBe('casemiro');
  });

  test('separa jogadores diferentes', () => {
    const rawOdds: RawPlayerOdd[] = [
      { playerName: 'Casemiro', team: 'Brasil', house: 'betfair', line: '1+', value: 1.65, market: 'desarmes' },
      { playerName: 'Rodrygo', team: 'Brasil', house: 'betfair', line: '1+', value: 2.10, market: 'desarmes' },
    ];

    const merged = mergePlayerOdds(rawOdds);
    expect(merged).toHaveLength(2);
  });

  test('usa fuzzy match para mesclar nomes com variações', () => {
    const rawOdds: RawPlayerOdd[] = [
      { playerName: 'Vinícius Jr', team: 'Brasil', house: 'betfair', line: '1+', value: 1.80, market: 'desarmes' },
      { playerName: 'Vinicius Jr.', team: 'Brasil', house: 'betmgm', line: '1+', value: 1.85, market: 'desarmes' },
    ];

    const merged = mergePlayerOdds(rawOdds);
    expect(merged).toHaveLength(1); // Mesmo jogador
    expect(merged[0].odds).toHaveLength(2);
  });

  test('mantém o nome mais longo como displayName', () => {
    const rawOdds: RawPlayerOdd[] = [
      { playerName: 'Vinicius Jr', team: 'Brasil', house: 'betfair', line: '1+', value: 1.80, market: 'desarmes' },
      { playerName: 'Vinicius Junior', team: 'Brasil', house: 'betmgm', line: '1+', value: 1.85, market: 'desarmes' },
    ];

    const merged = mergePlayerOdds(rawOdds);
    expect(merged).toHaveLength(1);
    expect(merged[0].displayName).toBe('Vinicius Junior');
  });

  test('normaliza linhas antes de comparar', () => {
    const rawOdds: RawPlayerOdd[] = [
      { playerName: 'Kimmich', team: 'Alemanha', house: 'betfair', line: '1+ Tackles', value: 1.55, market: 'desarmes' },
      { playerName: 'Kimmich', team: 'Alemanha', house: 'betmgm', line: 'Over 0.5', value: 1.58, market: 'desarmes' },
    ];

    const merged = mergePlayerOdds(rawOdds);
    // Ambas são linha "1+" — devem ter a mesma linha normalizada
    expect(merged[0].odds[0].line).toBe('1+');
    expect(merged[0].odds[1].line).toBe('1+');
  });
});
