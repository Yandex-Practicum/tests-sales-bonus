const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
let data = require('../__fixtures__/dataset_1.json');
let dataEtalon = require('../__fixtures__/dataset_etalon_1.json');
let dataEtalonAlt = require('../__fixtures__/dataset_etalon_1_alt.json');

const FUNC_NAMES = ['calculateSimpleRevenue', 'calculateBonusByProfit', 'analyzeSalesData'];

let mainContent;
let funcs;

async function fetchFileContent(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      let data = '';

      // Получаем данные по частям
      response.on('data', (chunk) => {
        data += chunk;
      });

      // Когда все данные получены
      response.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

beforeAll(async () => {
  try {
    // Читаем основной файл
    mainContent = fs.readFileSync(path.join(process.env.GITHUB_WORKSPACE, 'src', 'main.js'), 'utf8');
  } catch (e) {
    throw new Error(`Ошибка при чтении файла main.js: ${e.message}`);
  }

  try {
    // Получаем функции из main.js
    const mainFunc = new Function(`${mainContent} return { ${FUNC_NAMES.join(', ')} };`);
    funcs = mainFunc();
  } catch (e) {
    throw new Error(`Ошибка при получении функций из файла main.js: ${e.message}`);
  }

  try {
    const fileUrl = 'https://stub.practicum-team.ru/api/sp5_etl/sales_etalon.js';
    const datasetContent = await fetchFileContent(fileUrl);
    const datasetFunc = new Function(`${datasetContent}\nreturn data`);
    dataset = datasetFunc();
    let { etalon, ...rest } = dataset;
    data = rest;
    dataEtalon = etalon;
  } catch (e) { }
  fs.mkdirSync(path.join(process.env.DIR_TESTS, 'output', 'dataset'), { recursive: true });
  fs.writeFileSync(path.join(process.env.DIR_TESTS, 'output', 'dataset', 'dataset.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(process.env.DIR_TESTS, 'output', 'dataset', 'dataset_etalon.json'), JSON.stringify(dataEtalon));
});

describe('Функция расчета прибыли: calculateSimpleRevenue', () => {
  let calculateSimpleRevenue;

  beforeAll(() => {
    ({ calculateSimpleRevenue } = funcs);
  });

  test('Корректность расчета прибыли без скидки', () => {
    const product = { sku: 'SKU_001', purchase_price: 50 };
    const purchase = { sale_price: 100, quantity: 2, discount: 0 };
    const result = calculateSimpleRevenue(purchase, product);
    expect(result).toBe(200); // 100 * 2 * (1 - 0) = 200
  });

  test('Корректность расчета прибыли со скидкой', () => {
    const product = { sku: 'SKU_001', purchase_price: 50 };
    const purchase = { sale_price: 100, quantity: 2, discount: 20 };
    const result = calculateSimpleRevenue(purchase, product);
    expect(result).toBe(160); // 100 * 2 * (1 - 0.20) = 160
  });
});

describe('Функция расчета бонусов: calculateBonusByProfit', () => {
  const seller = { profit: 1000 };
  let calculateBonusByProfit;

  beforeAll(() => {
    ({ calculateBonusByProfit } = funcs);
  });

  test('Корректность расчета бонусов для первого продавца', () => {
    const result = calculateBonusByProfit(0, 5, seller);
    expect(result).toBe(150); // 1000 * 0.15 = 150
  });

  test('Корректность расчета бонусов для второго и третьего продавцов', () => {
    const result1 = calculateBonusByProfit(1, 5, seller);
    const result2 = calculateBonusByProfit(2, 5, seller);
    expect(result1).toBe(100); // 1000 * 0.10 = 100
    expect(result2).toBe(100); // 1000 * 0.10 = 100
  });

  test('Корректность расчета бонусов для предпоследнего продавца', () => {
    const result = calculateBonusByProfit(3, 5, seller);
    expect(result).toBe(50); // 1000 * 0.05 = 50
  });

  test('Корректность расчета бонусов для последнего продавца', () => {
    const result = calculateBonusByProfit(4, 5, seller);
    expect(result).toBe(0);
  });
});

describe('Функция анализа данных продаж: analyzeSalesData', () => {
  let calculateSimpleRevenue, calculateBonusByProfit, analyzeSalesData;

  beforeAll(() => {
    ({ calculateSimpleRevenue, calculateBonusByProfit, analyzeSalesData } = funcs);
  });

  test('Исключение при некорректной передаче опций', () => {
    expect(() => analyzeSalesData(data)).toThrow();
    expect(() => analyzeSalesData(data, { calculateRevenue: jest.fn() })).toThrow();
    expect(() => analyzeSalesData(data, { calculateBonus: jest.fn() })).toThrow();
  });

  test('Ошибка при отсутствии данных', () => {
    const invalidData = null;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrow();
  });

  test('Ошибка при отсутствии sellers', () => {
    const { sellers, ...invalidData } = data;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrow();
  });

  test('Ошибка при отсутствии products', () => {
    const { products, ...invalidData } = data;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrow();
  });

  test('Ошибка при отсутствии purchase_records', () => {
    const { purchase_records, ...invalidData } = data;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrow();
  });

  test('Ошибка при пустом массиве sellers', () => {
    const { ...invalidData } = data;
    invalidData.sellers = [];

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrow();
  });

  test('Ошибка при пустом массиве products', () => {
    const { ...invalidData } = data;
    invalidData.products = [];

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrow();
  });

  test('Ошибка при пустом массиве purchase_records', () => {
    const { ...invalidData } = data;
    invalidData.purchase_records = [];

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrow();
  });

  test('Корректность результата анализа данных продаж', () => {
    const result = analyzeSalesData(data, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    });

    expect([dataEtalon, dataEtalonAlt]).toContainEqual(result);
  });
});
