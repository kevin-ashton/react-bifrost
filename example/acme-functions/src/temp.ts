export interface Person {
  id?: string;
  name: string;
  age: number;
  weight: number;
  favFoods: {
    asian: string;
    italian: string;
    american: string;
  };
}

export const dummyData: Person[] = [
  {
    id: 'p1',
    name: 'Fred',
    age: 35,
    weight: 200,
    favFoods: {
      american: 'burger',
      asian: 'orange chicken',
      italian: 'pizza'
    }
  },
  {
    id: 'p2',
    name: 'Bob',
    age: 35,
    weight: 205,
    favFoods: {
      american: 'burger',
      asian: 'rice',
      italian: 'pizza'
    }
  },
  {
    id: 'p3',
    name: 'Henry',
    age: 2,
    weight: 25,
    favFoods: {
      american: 'burger',
      asian: 'miso soup',
      italian: 'pizza'
    }
  },
  {
    id: 'p4',
    name: 'Elaine',
    age: 4,
    weight: 30,
    favFoods: {
      american: 'burger',
      asian: 'sushi',
      italian: 'pizza'
    }
  }
];
