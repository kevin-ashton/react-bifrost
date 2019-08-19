#!/usr/bin/env bash

root=`pwd`

cd $root/module
rm -Rf node_modules
yarn install
yarn build


cd $root/example/acme-functions
rm -Rf node_modules
yarn install
yarn build

cd $root/example/acme-server
rm -Rf node_modules
yarn install
yarn build

cd $root/example/acme-web-client
rm -Rf node_modules
yarn install
