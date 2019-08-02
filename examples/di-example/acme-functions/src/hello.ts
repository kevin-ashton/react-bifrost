export async function hello1(p: { name: string }): Promise<string> {
  return `Hello 1 ${p.name}!!!`;
}

export async function hello2(p: { name: string; age: number }): Promise<string> {
  return `Hello 2 ${p.name}. You are ${p.age} years old`;
}

export async function hello3(p: { name: string; age: number }): Promise<string> {
  return `Hello 3 ${p.name}. You are ${p.age} years old`;
}
