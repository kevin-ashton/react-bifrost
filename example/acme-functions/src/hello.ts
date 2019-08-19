import { createBifrostSub, BifrostSub } from 'react-bifrost';
import { dummyData, Person } from './temp';
import { FirestoreLift, BatchRunner, BatchTask } from 'firestore-lift';
import * as firebase from 'firebase';

console.log('Init test');

const firebaseConfig = {
  apiKey: 'AIzaSyAX6T_6ad-rsPjXfITfj74aIySbQ1CL2L0',
  authDomain: 'firestore-lift-sandbox.firebaseapp.com',
  databaseURL: 'https://firestore-lift-sandbox.firebaseio.com',
  projectId: 'firestore-lift-sandbox',
  storageBucket: 'firestore-lift-sandbox.appspot.com',
  messagingSenderId: '965988214603',
  appId: '1:965988214603:web:1f66f5ea87563055'
};
firebase.initializeApp(firebaseConfig);

const batchRunner = new BatchRunner({
  firestore: firebase.firestore
});

let personHelper = new FirestoreLift<Person>({
  collection: 'person',
  batchRunner,
  addIdPropertyByDefault: true,
  prefixIdWithCollection: true
});

async function init() {
  console.log('-------------------------------------------------------------');
  console.log('Run init');
  console.log('-------------------------------------------------------------');
  try {
    let r1 = await firebase.auth().signInWithEmailAndPassword('test@example.com', '25...y');
    console.log('User logged in');
    await resetData();
  } catch (e) {
    console.log(e);
  }
}
init();

async function resetData() {
  console.log('Reset data');
  let batchTasks: BatchTask[] = [];
  for (let i = 0; i < dummyData.length; i++) {
    batchTasks.push(await personHelper.add({ item: dummyData[i] }, { returnBatchTask: true }));
  }
  try {
    console.log('Run batch reset');
    await batchRunner.executeBatch(batchTasks);
    console.log('Reset run?');
  } catch (e) {
    console.log('Trouble running reset');
    console.error(e);
  }
}

export async function hello1(p: { name: string; age: number }): Promise<string> {
  return `Hello 1 ${p.name}!!!`;
}
hello1.exampleAuthFn = (req) => {
  console.log(req.body);
  console.log(req.headers);
  // Example of throwing an error which will return a 401 unauthorized
  throw {
    statusCode: 401,
    error: new Error('not authorized')
  };
};

export async function hello2(p: { name: string; age: number }): Promise<string> {
  return `Hello 2 ${p.name}. You are ${p.age} years old`;
}
hello2.exampleAuthFn = () => console.log('Auth looks good');

export async function helloDelayed(p: { name: string; age: number }): Promise<string> {
  await new Promise((r) => setTimeout(() => r(), 2000));
  return `Hello delayed ${p.name}. You are ${p.age} years old. ${Math.random()}`;
}
helloDelayed.exampleAuthFn = () => console.log('Auth looks good');

interface HelloPubRtn {
  people: Person[];
}

export async function helloPub(p: { name: string; age: number }): Promise<BifrostSub<HelloPubRtn>> {
  let disposeFns = [];

  let instance = createBifrostSub<HelloPubRtn>({
    dispose: () => {
      disposeFns.forEach((fn) => fn());
    }
  });

  let r1 = await personHelper.querySubscription({});

  let peopleSubscription = r1.subscribe((p) => {
    instance.nextData({ people: p.items });
  });

  disposeFns.push(() => {
    peopleSubscription.unsubscribe();
  });

  return instance;
}
