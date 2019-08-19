#!/bin/bash

echo "Create some symbolic links when developing"

root=`pwd`

echo "Acme Functions"
rm -Rf $root/example/acme-functions/node_modules/react-bifrost
ln -s $root/module $root/example/acme-functions/node_modules/react-bifrost

echo "Acme Server"
rm -Rf $root/example/acme-server/node_modules/acme-functions
ln -s $root/example/acme-functions $root/example/acme-server/node_modules/acme-functions

rm -Rf $root/example/acme-server/node_modules/react-bifrost
ln -s $root/module $root/example/acme-server/node_modules/react-bifrost


echo "Acme Web Client"
rm -Rf $root/example/acme-web-client/node_modules/acme-functions
ln -s $root/example/acme-functions $root/example/acme-web-client/node_modules/acme-functions

rm -Rf $root/example/acme-web-client/node_modules/react-bifrost
ln -s $root/module $root/example/acme-web-client/node_modules/react-bifrost
