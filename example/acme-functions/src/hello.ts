import { BehaviorSubject } from 'rxjs';

export async function hello1(p: { name: string; age: number }, req?: any): Promise<string> {
  if (req) {
    console.log('Means we are on the server');
    console.log(req.body);
    console.log(req.headers);

    // Example of setting a custom status code
    throw {
      statusCode: 401,
      error: new Error('Need access')
    };
  }
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

let sharedObs = new BehaviorSubject(Math.random());

setInterval(() => {
  sharedObs.next(Math.random());
}, 3000);

export async function helloSub(p: { name: string; age: number }): Promise<BehaviorSubject<number>> {
  return sharedObs;
}
