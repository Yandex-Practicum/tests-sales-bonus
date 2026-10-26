const fs = require('fs');
const path = require('path');

const FUNC_NAMES = ['calculateSimpleRevenue', 'calculateBonusByProfit', 'analyzeSalesData'];

// Версия стартера задаётся в workflow стартера (env STARTER_VERSION). В копиях, выданных до версии 2, переменной нет.
// Версия 1: выручку продавца принимаем и как сумму calculateRevenue по товарам, и как сумму total_amount чеков
// (так было в прежнем тексте задания). Версия 2: только сумма calculateRevenue.
const STARTER_VERSION = Number(process.env.STARTER_VERSION) || 1;

// Наборы данных из папки data стартера и эталонные отчёты для них
const FIXTURES = [1, 2, 3].map(n => ({
  name: `data/dataset_${n}.js`,
  data: require(`../__fixtures__/dataset_${n}.json`),
  etalon: require(`../__fixtures__/dataset_etalon_${n}.json`)
}));

// Наборы данных, которых нет в стартере: проверяют, что решение не подогнано под данные стартера
const HIDDEN_FIXTURES = [1, 2, 3, 4, 5].map(n => ({
  name: `дополнительный набор ${n}`,
  file: `hidden_${n}`,
  data: require(`../__fixtures__/hidden_${n}.json`),
  etalon: require(`../__fixtures__/hidden_etalon_${n}.json`)
}));

const REPORT_FIELDS = ['seller_id', 'name', 'revenue', 'profit', 'sales_count', 'top_products', 'bonus'];
const MONEY_FIELDS = { revenue: 'выручка', profit: 'прибыль', bonus: 'бонус' };
// Допуск на погрешность вычислений с дробными числами
const MONEY_DELTA = 0.01 + 1e-9;

let mainContent;
let funcs;
let data = FIXTURES[0].data;

// Количество проданных товаров и сумма чеков по каждому продавцу — для подсказок в сообщениях
function collectFacts(data) {
  const facts = {};
  data.purchase_records.forEach(record => {
    const seller = facts[record.seller_id] ??= { sold: {}, totalAmount: 0 };
    seller.totalAmount += record.total_amount;
    record.items.forEach(item => {
      seller.sold[item.sku] = (seller.sold[item.sku] || 0) + item.quantity;
    });
  });
  return facts;
}

function checkTopProducts(place, received, expected, sold) {
  if (!Array.isArray(received)) {
    return [`${place}: top_products должен быть массивом`];
  }
  if (received.length !== expected.length) {
    return [`${place}: в top_products ожидалось ${expected.length} товаров, получено ${received.length}`];
  }

  const errors = [];
  const seen = new Set();
  received.forEach((product, i) => {
    const keys = product && typeof product === 'object' ? Object.keys(product).sort().join(', ') : String(product);
    if (keys !== 'quantity, sku') {
      errors.push(`${place}: элемент top_products[${i}] должен иметь вид { sku, quantity }, получено: ${JSON.stringify(product)}`);
      return;
    }
    if (seen.has(product.sku)) {
      errors.push(`${place}: товар ${product.sku} встречается в top_products дважды`);
    }
    seen.add(product.sku);
    if (sold[product.sku] !== product.quantity) {
      errors.push(`${place}: у товара ${product.sku} в top_products количество ${product.quantity}, а продавец продал ${sold[product.sku] ?? 0} шт.`);
    }
  });

  // Товары с равным количеством могут стоять в любом порядке, поэтому сверяем только последовательность количеств
  const receivedQuantities = received.map(product => product && product.quantity);
  const expectedQuantities = expected.map(product => product.quantity);
  if (errors.length === 0 && receivedQuantities.join() !== expectedQuantities.join()) {
    errors.push(`${place}: количества в top_products должны быть [${expectedQuantities}], получено [${receivedQuantities}]. ` +
      'Проверьте сортировку по убыванию quantity и выбор первых 10 товаров');
  }
  return errors;
}

function checkReport(received, data, etalon) {
  if (!Array.isArray(received)) {
    return [`analyzeSalesData должна вернуть массив, получено: ${JSON.stringify(received)}`];
  }
  if (received.length !== etalon.length) {
    return [`В отчёте ожидалось ${etalon.length} продавцов, получено ${received.length}`];
  }

  const facts = collectFacts(data);
  const errors = [];
  etalon.forEach((expected, i) => {
    const seller = received[i];
    const place = `Место ${i + 1} (${expected.seller_id})`;

    if (!seller || typeof seller !== 'object') {
      errors.push(`${place}: ожидался объект продавца, получено: ${JSON.stringify(seller)}`);
      return;
    }
    if (seller.seller_id !== expected.seller_id) {
      errors.push(`Место ${i + 1}: ожидался продавец ${expected.seller_id}, получен ${seller.seller_id}. ` +
        'Проверьте расчёт прибыли и сортировку продавцов по убыванию прибыли');
      return;
    }

    const missing = REPORT_FIELDS.filter(field => !(field in seller));
    const extra = Object.keys(seller).filter(field => !REPORT_FIELDS.includes(field));
    if (missing.length) errors.push(`${place}: нет полей ${missing.join(', ')}`);
    if (extra.length) errors.push(`${place}: лишние поля ${extra.join(', ')}`);

    if (seller.name !== expected.name) {
      errors.push(`${place}: name должно быть "${expected.name}", получено ${JSON.stringify(seller.name)}`);
    }
    if (seller.sales_count !== expected.sales_count) {
      errors.push(`${place}: sales_count должно быть ${expected.sales_count}, получено ${JSON.stringify(seller.sales_count)}`);
    }

    Object.entries(MONEY_FIELDS).forEach(([field, title]) => {
      const value = seller[field];
      const isClose = target => typeof value === 'number' && Math.abs(value - target) <= MONEY_DELTA;
      const totalAmount = +facts[expected.seller_id].totalAmount.toFixed(2);
      if (field === 'revenue' && STARTER_VERSION === 1 && isClose(totalAmount)) {
        return;
      }
      if (!isClose(expected[field])) {
        let message = `${place}: ${field} (${title}) должно быть ${expected[field]}, получено ${JSON.stringify(value)}`;
        if (typeof value === 'string') {
          message += '. Значение должно быть числом, а не строкой: проверьте преобразование после toFixed(2)';
        } else if (field === 'revenue' && isClose(totalAmount)) {
          message += '. Выручку продавца нужно считать как сумму calculateRevenue по всем товарам, а не по полю total_amount';
        }
        errors.push(message);
      }
    });

    errors.push(...checkTopProducts(place, seller.top_products, expected.top_products, facts[expected.seller_id].sold));
  });
  return errors;
}

expect.extend({
  // Функция должна остановиться на своей проверке. В стартере версии 2 часть кода готова и падает с TypeError на
  // неверных данных сама, поэтому для версии 2 случайные ошибки движка (TypeError, ReferenceError) не засчитываются
  toThrowCheckError(received) {
    try {
      received();
    } catch (e) {
      const accidental = STARTER_VERSION >= 2 && (e instanceof TypeError || e instanceof ReferenceError);
      return {
        pass: !accidental,
        message: () => accidental
          ? `Функция завершилась не на проверке, а с ошибкой «${e.name}: ${e.message}». ` +
            'Проверьте входные данные в начале analyzeSalesData и вызовите throw new Error(...)'
          : 'Функция выбросила ошибку'
      };
    }
    return {
      pass: false,
      message: () => 'Ожидалось, что функция выбросит ошибку через throw, но она завершилась без ошибки'
    };
  },

  toMatchSalesReport(received, data, etalon) {
    const errors = checkReport(received, data, etalon);
    return {
      pass: errors.length === 0,
      message: () => errors.length
        ? `Отчёт не совпадает с ожидаемым:\n- ${errors.join('\n- ')}`
        : 'Отчёт совпадает с ожидаемым'
    };
  }
});

beforeAll(() => {
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
});

describe('Функция расчета выручки: calculateSimpleRevenue', () => {
  let calculateSimpleRevenue;

  beforeAll(() => {
    ({ calculateSimpleRevenue } = funcs);
  });

  test('Корректность расчета выручки без скидки', () => {
    const product = { sku: 'SKU_001', purchase_price: 50 };
    const purchase = { sale_price: 100, quantity: 2, discount: 0 };
    const result = calculateSimpleRevenue(purchase, product);
    expect(result).toBe(200); // 100 * 2 * (1 - 0) = 200
  });

  test('Корректность расчета выручки со скидкой', () => {
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
    expect(() => analyzeSalesData(data, { calculateRevenue: jest.fn() })).toThrowCheckError();
    expect(() => analyzeSalesData(data, { calculateBonus: jest.fn() })).toThrowCheckError();
  });

  test('Ошибка при отсутствии данных', () => {
    const invalidData = null;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrowCheckError();
  });

  test('Ошибка при отсутствии sellers', () => {
    const { sellers, ...invalidData } = data;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrowCheckError();
  });

  test('Ошибка при отсутствии products', () => {
    const { products, ...invalidData } = data;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrowCheckError();
  });

  test('Ошибка при отсутствии purchase_records', () => {
    const { purchase_records, ...invalidData } = data;

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrowCheckError();
  });

  test('Ошибка при пустом массиве sellers', () => {
    const { ...invalidData } = data;
    invalidData.sellers = [];

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrowCheckError();
  });

  test('Ошибка при пустом массиве products', () => {
    const { ...invalidData } = data;
    invalidData.products = [];

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrowCheckError();
  });

  test('Ошибка при пустом массиве purchase_records', () => {
    const { ...invalidData } = data;
    invalidData.purchase_records = [];

    expect(() => analyzeSalesData(invalidData, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    })).toThrowCheckError();
  });

  test.each(FIXTURES)('Корректность результата анализа данных продаж: $name', ({ data, etalon }) => {
    const result = analyzeSalesData(data, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    });

    expect(result).toMatchSalesReport(data, etalon);
  });

  test.each(HIDDEN_FIXTURES)('Корректность результата анализа данных продаж: $name', ({ file, data, etalon }) => {
    const result = analyzeSalesData(data, {
      calculateRevenue: calculateSimpleRevenue,
      calculateBonus: calculateBonusByProfit
    });

    // Этих данных нет в стартере: при ошибке сохраняем их в артефакт output, чтобы можно было повторить расчёт
    if (checkReport(result, data, etalon).length) {
      const dir = path.join(process.env.DIR_TESTS, 'output', 'dataset');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify(data));
      fs.writeFileSync(path.join(dir, `${file}_etalon.json`), JSON.stringify(etalon, null, 2));
    }

    expect(result).toMatchSalesReport(data, etalon);
  });
});
