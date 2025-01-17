#!/bin/bash

echo "УСТАНОВКА ЗАВИСИМОСТЕЙ"
npm ci --prefix $DIR_TESTS > /dev/null

echo "ЗАПУСК ТЕСТОВ"
cd $DIR_TESTS || exit
npm run test