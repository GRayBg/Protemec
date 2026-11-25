import { useEffect, useMemo } from 'react'
import { useGLTF, Center } from '@react-three/drei'
import * as THREE from 'three'

export function Almacen3D({ ubicacionesDestacadas = [] }) {
  const { scene } = useGLTF('/almacen.glb')

  const materialResaltado = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#00ff66',
        emissive: '#00aa33',
        emissiveIntensity: 0.8,
        roughness: 0.3
      }),
    []
  )

  useEffect(() => {
    return () => {
      materialResaltado.dispose()
    }
  }, [materialResaltado])

  useEffect(() => {
    if (!scene) return

    const listaUbicacionesLwr = ubicacionesDestacadas.map((u) => String(u).toLowerCase())

    scene.traverse((child) => {
      if (child.isMesh) {
        if (!child.userData.materialOriginal) {
          child.userData.materialOriginal = child.material
        }

        const nombreNodoLwr = child.name.toLowerCase()
        const esCoincidencia = listaUbicacionesLwr.some((ub) => nombreNodoLwr.includes(ub))

        child.material = esCoincidencia ? materialResaltado : child.userData.materialOriginal
      }
    })
  }, [ubicacionesDestacadas, scene, materialResaltado])

  return (
    <Center>
      <primitive object={scene} />
    </Center>
  )
}

useGLTF.preload('/almacen.glb')
