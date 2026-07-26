import { isSamePlayer, normalizeTeamName } from '../src/lib/normalize';

describe('isSamePlayer — regressões de nomes completos', () => {
  const cases: [string, string, boolean][] = [
    // Casos que já quebraram e devem continuar cobertos por regressão.
    ['Alexsander', 'Alexsander Cristhian Gomes da Costa', true],
    ['Everton Ribeiro', 'Éverton Augusto de Barros Ribeiro', true],
    ['Nicolas Acevedo', 'Nicolás Brian Acevedo Tabárez', true],
    ['Michel Araujo', 'Michel Daryl Araújo Villar', true],
    ['Renan Lodi', 'Renan Augusto Lodi dos Santos', true],
    ['Alexsander Cristhian Gomes da Costa', 'Alexsander', true],

    // Casos que já funcionavam e devem permanecer estáveis.
    ['Khellven', 'Khellven da Silva', true],
    ['J. Arias', 'Jhon Arias', true],
    ['A. Gabriel', 'Arthur Gabriel', true],
    ['Rodrigo Nestor', 'Rodrigo Nestor Bertalia', true],
    ['V. Paulista', 'Vinicius Paulista', true],
    ['B. Lopes', 'Breno Lopes', true],
    ['B. Fuchs', 'Bruno Fuchs', true],

    // Casos que não podem produzir falso positivo.
    ['João Pedro', 'João Paulo', false],

    // Dentro de uma partida, o nome curto pode representar o nome completo.
    ['Gabriel', 'Gabriel Mercado', true],
    ['Lucas', 'Lucas Evangelista', true],
    ['Mateo', 'Mateo Cassierra', true],
  ];

  test.each(cases)('compara "%s" com "%s"', (a, b, expected) => {
    expect(isSamePlayer(a, b)).toBe(expected);
  });
});

describe('normalizeTeamName — regressões de fontes', () => {
  test('recupera o nome truncado do LA Galaxy', () => {
    expect(normalizeTeamName('Los Angeles Gala')).toBe('LA Galaxy');
  });
});
