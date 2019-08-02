export function hello1(p: { name: string }): string {
  return `Hello 1 ${p.name}!!!`;
}

export function hello2(p: { name: string; age: number }): string {
  return `Hello 2 ${p.name}. You are ${p.age} years old`;
}

export function hello3(p: { name: string; age: number }): string {
  return `Hello 3 ${p.name}. You are ${p.age} years old`;
}
