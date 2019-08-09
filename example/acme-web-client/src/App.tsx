import React, { useEffect, useState } from 'react';
import { createBifrost } from 'react-bifrost';
import * as functions from 'acme-functions';
import axios from 'axios';
import './App.css';

let exampleCache: any = {};

let bifrost = createBifrost<typeof functions>({
  fns: functions,
  reactModule: React,
  httpProcessor: async ({ fnName, payload }) => {
    let r1 = await axios.post(`http://localhost:8080/api-functions/${fnName}`, payload, {
      headers: { Authorization: 'ExampleToken...' }
    });
    return r1.data;
  },
  useCacheFns: {
    getItem: async (p) => exampleCache[p.key] || undefined,
    setItem: async (p) => {
      exampleCache[p.key] = p.valueStringified;
    }
  }
});

const App: React.FC = () => {
  const [showComp1, setShowComp1] = useState(true);

  return (
    <div className="App">
      <header className="App-header">
        {showComp1 ? <Comp1 /> : null}
        <p onClick={() => setShowComp1(!showComp1)}>Toggle Comp 1</p>
      </header>
    </div>
  );
};

function Comp1() {
  const r1 = bifrost.hello2.useLocal({ age: 34, name: 'Kevin' });

  const r2 = bifrost.helloDelayed.useRemote({ age: 10, name: 'Bob' });

  useEffect(() => {
    console.log('Comp1 mount');

    return () => {
      console.log('Comp1 unmount');
    };
  }, []);

  useEffect(() => {
    (async () => {
      // let r = await bifrost.hello2.fetchRemote({ name: 'Scott', age: 34 });
      // console.log(r);
    })();
  }, []);

  if (r1.isLoading || r2.isLoading) {
    return <div>Loading</div>;
  }

  return (
    <div>
      <h1>{r1.data}</h1>
      <h1>{r2.data}</h1>
    </div>
  );
}

export default App;
