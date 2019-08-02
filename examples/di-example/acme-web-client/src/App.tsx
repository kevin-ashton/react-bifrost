import React from 'react';
import { createBifrostHooks } from 'react-bifrost';
import { functions } from 'acme-functions';
import axios from 'axios';
import './App.css';

let hooks = createBifrostHooks<typeof functions>(functions, React ,async ({ fnName, payload }) => {
  let r1 = await axios.post(`http://localhost:8080/api-functions/${fnName}`, payload, { headers: { Authorization: 'ExampleToken...' } });
  return r1.data;
});

const App: React.FC = () => {
  return (
    <div className="App">
      <header className="App-header">
        <Comp1 />
        <p>
          Edit <code>src/App.tsx</code> and save to reload.
        </p>
        <a className="App-link" href="https://reactjs.org" target="_blank" rel="noopener noreferrer">
          Learn React
        </a>
      </header>
    </div>
  );
};

function Comp1() {
  const { isLoading, data, error } = hooks.hello3.useRemote({ name: 'Kevin', age: 35 });

  if (isLoading) {
    return <div>Loading</div>;
  }

  return (
    <div>
      <h1>{data}</h1>
    </div>
  );
}

export default App;
