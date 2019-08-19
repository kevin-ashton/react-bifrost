import React, { useEffect, useState } from 'react';
import { createBifrost } from 'react-bifrost';
import * as functions from 'acme-functions';
import axios from 'axios';
import './App.css';

let exampleCache: Record<string, any> = {};

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
    getCachedFnResult: async (p) => exampleCache[p.key] || undefined,
    setCachedFnResult: async (p) => {
      exampleCache[p.key] = p.value;
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

  const r2 = bifrost.helloDelayed.useLocal({ age: 10, name: 'Bob' });

  const r3 = bifrost.helloPub.useLocalSub({ name: 'Kevin', age: 34 }, []);

  console.log('render...')


  useEffect(() => {
    console.log('Comp1 mount');

    return () => {
      console.log('Comp1 unmount');
    };
  }, []);

  if (r1.isLoading || r2.isLoading || r3.isLoading) {
    return <div>Loading</div>;
  }

  return (
    <div>
      {/* <h1>{r1.data}</h1> */}
      {/* <h1>{r2.data}</h1> */}
      <h1>Auto {JSON.stringify(r3.data)}</h1>
    </div>
  );
}

export default App;
