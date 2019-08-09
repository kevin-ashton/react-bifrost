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

export async function hello2(p: { name: string; age: number }): Promise<string> {
  return `Hello 2 ${p.name}. You are ${p.age} years old`;
}

export async function helloDelayed(p: { name: string; age: number }): Promise<string> {
  await new Promise((r) => setTimeout(() => r(), 2000));
  return `Hello delayed ${p.name}. You are ${p.age} years old. ${Math.random()}`;
}
